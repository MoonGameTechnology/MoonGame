/**
 * Тесты канала поставки и проводки RuStore SDK (RUS-3).
 *
 * Скрипты упаковки правят СГЕНЕРИРОВАННЫЙ Android-проект, которого в репозитории нет
 * (`android/` создаёт `cap add android` в CI), а Android SDK и репозиторий RuStore из
 * сессии разработки недоступны. Поэтому здесь скрипты гоняются по-настоящему, в
 * песочнице, на дословной копии шаблона Capacitor 8.5.2 (`mobile/package-lock.json`),
 * а компиляцию Java проверяет CI-сборка канала `rustore` (`.github/workflows/android.yml`).
 *
 * Что держится и почему:
 * 1. Канал по умолчанию — `github`, и в нём RuStore не трогает ничего: dev/player-полосы
 *    собираются ровно как до RUS-3.
 * 2. В канале `rustore` GitHub-моста (`VoidNative.open`, переход к стороннему APK) нет
 *    вовсе, а MainActivity пишет ровно один скрипт.
 * 3. Репозиторий RuStore объявлен эксклюзивным для групп `ru.rustore` — артефакты RuStore
 *    не ищутся нигде, кроме него, и ничего другого не ищется в нём.
 * 4. Повторный прогон ничего не дублирует; сдвинувшийся якорь шаблона роняет сборку.
 * 5. Опечатка в канале роняет КАЖДЫЙ шаг: иначе стор-APK молча уехал бы с GitHub-полосой.
 * 6. Нативный мост говорит на том же языке, что веб-слой: каждое событие, которое шлёт
 *    Java, принимает строгий разбор `decisions/storeUpdate.ts`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStoreUpdateEvent } from '../decisions/storeUpdate.ts';
import { RUSTORE_EVENT } from '../prototype/src/rustoreUpdate.ts';

const run = promisify(execFile);
const MOBILE = dirname(fileURLToPath(import.meta.url));
const APP_ID = 'com.voiddominion.store';
const ACTIVITY = `android/app/src/main/java/${APP_ID.replace(/\./g, '/')}/MainActivity.java`;

/** `app/build.gradle` шаблона Capacitor 8.5.2 — дословно, это и есть якоря патча. */
const CAPACITOR_APP_GRADLE = `apply plugin: 'com.android.application'

android {
    namespace = "com.getcapacitor.myapp"
    compileSdk = rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "com.getcapacitor.app"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
        aaptOptions {
             // Files and dirs to omit from the packaged assets dir, modified to accommodate modern web apps.
             // Default: https://android.googlesource.com/platform/frameworks/base/+/282e181b58cf72b6ca770dc7ca5f91f135444502/tools/aapt/AaptAssets.cpp#61
            ignoreAssetsPattern = '!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~'
        }
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}

repositories {
    flatDir{
        dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs'
    }
}

dependencies {
    implementation fileTree(include: ['*.jar'], dir: 'libs')
    implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"
    implementation "androidx.coordinatorlayout:coordinatorlayout:$androidxCoordinatorLayoutVersion"
    implementation "androidx.core:core-splashscreen:$coreSplashScreenVersion"
    implementation project(':capacitor-android')
    testImplementation "junit:junit:$junitVersion"
    androidTestImplementation "androidx.test.ext:junit:$androidxJunitVersion"
    androidTestImplementation "androidx.test.espresso:espresso-core:$androidxEspressoCoreVersion"
    implementation project(':capacitor-cordova-android-plugins')
}

apply from: 'capacitor.build.gradle'
`;
const CAPACITOR_ACTIVITY = `package ${APP_ID};

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
`;

/** Песочница: настоящие скрипты упаковки + сгенерированный «android/» из шаблона. */
function sandbox({ gradle = CAPACITOR_APP_GRADLE } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'void-pack-'));
  for (const f of ['channel.mjs', 'patch-rustore.mjs', 'patch-updater.mjs', 'inject-build.mjs'])
    writeFileSync(join(dir, f), readFileSync(join(MOBILE, f)));
  writeFileSync(join(dir, 'capacitor.config.json'), JSON.stringify({ appId: APP_ID }));
  mkdirSync(join(dir, dirname(ACTIVITY)), { recursive: true });
  writeFileSync(join(dir, 'android/app/build.gradle'), gradle);
  writeFileSync(join(dir, ACTIVITY), CAPACITOR_ACTIVITY);
  writeFileSync(join(dir, 'index.html'), '<html><head></head><body></body></html>');
  const file = (p) => readFileSync(join(dir, p), 'utf8');
  /** Шаг упаковки как в CI: `node <script>` с каналом в окружении. */
  const step = (script, channel, args = []) => {
    const env = { ...process.env };
    delete env.VOID_CHANNEL;
    delete env.VOID_VC;
    delete env.VOID_VN;
    if (channel !== undefined) env.VOID_CHANNEL = channel;
    return run(process.execPath, [script, ...args], { cwd: dir, env });
  };
  return { dir, file, step };
}

/** Тело верхнеуровневого блока Gradle (`repositories {` … `}` в нулевой колонке). */
const block = (gradle, name) => {
  const start = gradle.indexOf(`\n${name} {\n`);
  return start < 0 ? '' : gradle.slice(start, gradle.indexOf('\n}\n', start));
};

describe('RUS-3 — канал github (по умолчанию): RuStore не трогает ничего', () => {
  it('patch-rustore — no-op, а patch-updater ставит прежний GitHub-мост', async () => {
    const s = sandbox();
    const { stdout } = await s.step('patch-rustore.mjs', undefined);
    expect(stdout).toContain('no-op');
    expect(s.file('android/app/build.gradle')).toBe(CAPACITOR_APP_GRADLE);
    expect(s.file(ACTIVITY)).toBe(CAPACITOR_ACTIVITY);

    await s.step('patch-updater.mjs', 'github');
    expect(s.file(ACTIVITY)).toContain('"VoidNative"');
    expect(s.file('android/app/build.gradle')).not.toContain('ru.rustore');
  });

  it('inject-build вшивает сборку байт-в-байт как до RUS-3 — без поля канала', async () => {
    const s = sandbox();
    await s.step('inject-build.mjs', undefined, ['index.html', '5', 'abc1234']);
    expect(s.file('index.html')).toContain('<script>window.__BUILD__={"versionCode":5,"sha":"abc1234"};</script>');
  });
});

describe('RUS-3 — канал rustore', () => {
  /** Полный прогон шагов бренда в порядке `npm run brand`. */
  async function brand() {
    const s = sandbox();
    await s.step('patch-updater.mjs', 'rustore');
    await s.step('patch-rustore.mjs', 'rustore');
    return s;
  }

  it('GitHub-моста нет: ни VoidNative, ни перехода по внешней ссылке (правило 2)', async () => {
    const java = (await brand()).file(ACTIVITY);
    expect(java.match(/addJavascriptInterface\(/g)).toHaveLength(1);
    expect(java).not.toContain('"VoidNative"');
    expect(java).not.toContain('ACTION_VIEW');
    expect(java).toContain(`package ${APP_ID};`);
    expect(java).toContain('addJavascriptInterface(ruStore, "VoidRuStore")');
  });

  it('patch-updater в этом канале MainActivity не пишет — её пишет ровно один скрипт', async () => {
    const s = sandbox();
    await s.step('patch-updater.mjs', 'rustore');
    expect(s.file(ACTIVITY)).toBe(CAPACITOR_ACTIVITY);
  });

  it('репозиторий RuStore — эксклюзивный для ru.rustore и стоит в блоке модуля (правило 3)', async () => {
    const gradle = (await brand()).file('android/app/build.gradle');
    const repos = block(gradle, 'repositories');
    expect(repos).toContain('exclusiveContent {');
    expect(repos).toContain("maven { url 'https://nexus-external.rustore.ru/repository/maven-rustore-exposed' }");
    expect(repos).toContain("includeGroupByRegex 'ru[.]rustore([.].*)?'");
    // Шаблонный flatDir на месте — патч дописывает, а не заменяет.
    expect(repos).toContain('flatDir{');
    for (const group of ['ru.rustore', 'ru.rustore.sdk'])
      expect(new RegExp('^ru[.]rustore([.].*)?$').test(group)).toBe(true);
    expect(new RegExp('^ru[.]rustore([.].*)?$').test('ru.rustorefake')).toBe(false);
  });

  it('SDK приходит одной BOM-версией: bom + appupdate без своей версии', async () => {
    const deps = block((await brand()).file('android/app/build.gradle'), 'dependencies');
    expect(deps).toMatch(/implementation platform\('ru\.rustore\.sdk:bom:\d{4}\.\d{2}\.\d{2}'\)/);
    expect(deps).toContain("implementation 'ru.rustore.sdk:appupdate'\n");
  });

  it('повторный прогон ничего не дублирует (правило 4)', async () => {
    const s = await brand();
    const once = s.file('android/app/build.gradle');
    await s.step('patch-rustore.mjs', 'rustore');
    expect(s.file('android/app/build.gradle')).toBe(once);
    expect(once.match(/maven-rustore-exposed/g)).toHaveLength(1);
  });

  it('сдвинувшийся якорь шаблона роняет сборку, а не патчит наполовину (правило 4)', async () => {
    const s = sandbox({ gradle: CAPACITOR_APP_GRADLE.replace('\nrepositories {\n', '\nrepositories{\n') });
    await expect(s.step('patch-rustore.mjs', 'rustore')).rejects.toThrow(/repositories/);
    expect(s.file('android/app/build.gradle')).not.toContain('ru.rustore');
  });

  it('inject-build вшивает канал рядом со сборкой', async () => {
    const s = sandbox();
    await s.step('inject-build.mjs', 'rustore', ['index.html', '5', 'abc1234']);
    expect(s.file('index.html')).toContain(
      '<script>window.__BUILD__={"versionCode":5,"sha":"abc1234","channel":"rustore"};</script>',
    );
  });
});

describe('RUS-3 — опечатка в канале роняет каждый шаг (правило 5)', () => {
  for (const [script, args] of [
    ['patch-rustore.mjs', []],
    ['patch-updater.mjs', []],
    ['inject-build.mjs', ['index.html', '5', 'abc1234']],
  ])
    it(script, async () => {
      const s = sandbox();
      await expect(s.step(script, 'rustor', args)).rejects.toThrow(/VOID_CHANNEL/);
      expect(s.file(ACTIVITY)).toBe(CAPACITOR_ACTIVITY);
      expect(s.file('index.html')).not.toContain('__BUILD__');
    });
});

describe('RUS-3 — нативный мост и веб-слой говорят на одном языке (правило 6)', () => {
  let src = '';
  beforeAll(async () => {
    const s = sandbox();
    await s.step('patch-rustore.mjs', 'rustore');
    src = s.file(ACTIVITY);
  });

  it('событие — то, которое слушает веб-слой', () => {
    expect(src).toContain(`new CustomEvent('${RUSTORE_EVENT}',{detail:`);
  });

  it('у моста ровно три вызова, и все — JavaScript-интерфейс', () => {
    for (const name of ['checkUpdate', 'startUpdate', 'completeUpdate'])
      expect(src).toMatch(new RegExp(`@JavascriptInterface\\s+public void ${name}\\(\\)`));
    expect(src.match(/@JavascriptInterface/g)).toHaveLength(3);
  });

  it('каждое событие, которое шлёт Java, принимает строгий разбор', () => {
    const sent = [...src.matchAll(/event\("(\w+)", "(\w+)"/g)];
    expect(new Set(sent.map((m) => m[1]))).toEqual(new Set(['check', 'flow', 'install', 'error']));
    // Значения, которые Java может подставить в каждое поле.
    const values = {
      available: [true, false],
      accepted: [true, false],
      status: ['downloaded', 'downloading', 'failed', 'other'],
      op: ['check', 'start', 'complete'],
    };
    for (const [, type, key] of sent)
      for (const value of values[key])
        expect(parseStoreUpdateEvent({ type, [key]: value }), `${type}.${key}=${value}`).not.toBeNull();
    // Статусы установки в Java — ровно те, что знает разбор.
    for (const status of values.status) expect(src).toContain(`"${status}"`);
    for (const op of values.op) expect(src).toContain(`"${op}"`);
  });

  it('звать мост вправе только своя страница (ограничение адресов моста)', () => {
    expect(src).toContain('"localhost".equals(uri.getHost())');
    expect(src).toMatch(/if \(!fromLocalPage\(\)\) return;/);
  });
});
