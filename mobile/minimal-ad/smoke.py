"""An offline emulator checks the real installed UI without requesting paid ads."""
import re
import subprocess
import sys
import time
from defusedxml import ElementTree as ET


def adb(*args):
    return subprocess.check_output(['adb', *args], timeout=25, text=True).strip()


def screen():
    adb('shell', 'uiautomator', 'dump', '/sdcard/ad-probe-ui.xml')
    return ET.fromstring(adb('exec-out', 'cat', '/sdcard/ad-probe-ui.xml'))


def package_uid(package):
    value = adb('shell', 'cmd', 'package', 'list', 'packages', '-U', package)
    match = re.search(r'\buid:(\d+)', value)
    assert match and 10000 <= int(match[1]) < 100000, 'E_PROBE_UID'
    return match[1]


deadline = time.monotonic() + 180
while time.monotonic() < deadline:
    try:
        if adb('shell', 'getprop', 'sys.boot_completed') == '1':
            break
    except subprocess.SubprocessError:
        pass
    time.sleep(3)
else:
    raise RuntimeError('E_PROBE_EMULATOR_BOOT')

adb('shell', 'svc', 'wifi', 'disable')
adb('shell', 'svc', 'data', 'disable')
adb('shell', 'input', 'keyevent', '82')
assert len(sys.argv) == 3, 'E_PROBE_GAME_FIXTURE'
# Keep the real game installed and seed a private marker without launching it.
adb('install', '-r', sys.argv[2])
game_uid = package_uid('com.voiddominion.player')
adb('shell', 'run-as', 'com.voiddominion.player', 'mkdir', '-p', 'files')
adb('shell', 'run-as', 'com.voiddominion.player', 'touch', 'files/ad-probe-coexistence')
adb('install', '-r', sys.argv[1])
probe_uid = package_uid('com.voiddominion.adprobe')
assert probe_uid != game_uid, 'E_PROBE_SHARED_UID'
assert package_uid('com.voiddominion.player') == game_uid, 'E_PROBE_REPLACED_GAME'
# AOSP emulator only: block this application's IPv4/IPv6 traffic even if a
# virtual Ethernet interface survives the Wi-Fi/mobile-data switches.
adb('root')
adb('wait-for-device')
for firewall in ['iptables', 'ip6tables']:
    adb('shell', firewall, '-I', 'OUTPUT', '-m', 'owner', '--uid-owner', probe_uid, '-j', 'REJECT')
adb('shell', 'am', 'start', '-W', '-n', 'com.voiddominion.adprobe/.AdProbeActivity')
ui = screen()
buttons = [n for n in ui.iter('node') if n.get('class') == 'android.widget.Button']
assert len(buttons) == 1 and buttons[0].get('enabled') == 'true', 'E_PROBE_ONE_BUTTON'
assert not any('WebView' in n.get('class', '') for n in ui.iter('node')), 'E_PROBE_WEBVIEW'
assert not any('VK-' in n.get('text', '') for n in ui.iter('node')), 'E_PROBE_AUTO_LOAD'
coords = list(map(int, re.findall(r'\d+', buttons[0].get('bounds', ''))))
assert len(coords) == 4, 'E_PROBE_BUTTON_BOUNDS'
adb('shell', 'input', 'tap', str((coords[0] + coords[2]) // 2), str((coords[1] + coords[3]) // 2))

deadline = time.monotonic() + 65
while time.monotonic() < deadline:
    ui = screen()
    buttons = [n for n in ui.iter('node') if n.get('class') == 'android.widget.Button']
    text = ' '.join(n.get('text', '') for n in ui.iter('node'))
    if re.search(r'VK-\d{1,5}|E_AD_[A-Z_]+', text) and len(buttons) == 1 and buttons[0].get('enabled') == 'true':
        print('Installed standalone APK: one button, no game WebView, explicit tap returns a bounded offline error, retry enabled.')
        break
    time.sleep(3)
else:
    raise RuntimeError('E_PROBE_BUTTON_RESULT')

logs = adb('logcat', '-d', '-s', 'VkAdProbe:I')
assert 'Test device configured' in logs, 'E_PROBE_TEST_DEVICE'
prefs = ET.fromstring(adb('exec-out', 'run-as', 'com.voiddominion.adprobe',
                          'cat', 'shared_prefs/mytarget_prefs.xml'))
instance = prefs.find("string[@name='instanceId']")
assert instance is not None and re.fullmatch(r'[a-f0-9-]{36}', instance.text or ''), 'E_PROBE_TEST_INSTALL'
print('SDK configured for the local test installation before loading the ad.')

adb('uninstall', 'com.voiddominion.adprobe')
assert package_uid('com.voiddominion.player') == game_uid, 'E_PROBE_REMOVED_GAME'
adb('shell', 'run-as', 'com.voiddominion.player', 'test', '-f', 'files/ad-probe-coexistence')
print('Both real APKs coexisted with different UIDs; removing the probe preserved the game and its private data marker.')
