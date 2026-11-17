import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

let dir;
const stubs = {
  'android/content/Context.java': 'package android.content; public class Context {}',
  'android/os/Looper.java': 'package android.os; public class Looper { public static Looper getMainLooper() { return new Looper(); } }',
  'android/os/Handler.java': `package android.os; import java.util.*;
    public class Handler {
      public static final List<Runnable> tasks = new ArrayList<>();
      public Handler(Looper looper) {} public void post(Runnable r) { r.run(); }
      public void postDelayed(Runnable r, long delay) { tasks.add(r); }
      public void removeCallbacks(Runnable r) { tasks.removeIf(t -> t == r); }
      public static void expire() { for (Runnable r : List.copyOf(tasks)) r.run(); }
    }`,
  'android/webkit/WebView.java': 'package android.webkit; public class WebView { public static String url="https://localhost/"; public String getUrl(){return url;} }',
  'androidx/annotation/NonNull.java': 'package androidx.annotation; public @interface NonNull {}',
  'androidx/lifecycle/Lifecycle.java': `package androidx.lifecycle; public class Lifecycle {
    public static boolean resumed=true; public enum State { CREATED, RESUMED; public boolean isAtLeast(State other){return this.ordinal()>=other.ordinal();} }
    public State getCurrentState(){return resumed?State.RESUMED:State.CREATED;} }`,
  'androidx/appcompat/app/AppCompatActivity.java': `package androidx.appcompat.app; public class AppCompatActivity extends android.content.Context {
    public boolean isFinishing(){return false;} public boolean isDestroyed(){return false;}
    public void runOnUiThread(Runnable r){r.run();} public androidx.lifecycle.Lifecycle getLifecycle(){return new androidx.lifecycle.Lifecycle();} }`,
  'com/getcapacitor/Bridge.java': 'package com.getcapacitor; public class Bridge { public android.webkit.WebView getWebView(){return new android.webkit.WebView();} }',
  'com/getcapacitor/Plugin.java': `package com.getcapacitor; public class Plugin {
    public androidx.appcompat.app.AppCompatActivity getActivity(){return new androidx.appcompat.app.AppCompatActivity();}
    public android.content.Context getContext(){return getActivity();} public Bridge getBridge(){return new Bridge();}
    protected void handleOnDestroy(){} }`,
  'com/getcapacitor/PluginMethod.java': 'package com.getcapacitor; public @interface PluginMethod {}',
  'com/getcapacitor/annotation/CapacitorPlugin.java': 'package com.getcapacitor.annotation; public @interface CapacitorPlugin { String name(); }',
  'com/getcapacitor/JSObject.java': 'package com.getcapacitor; public class JSObject extends java.util.HashMap<String,Object> {}',
  'com/getcapacitor/PluginCall.java': `package com.getcapacitor; public class PluginCall {
    public String placement="main.supply", requestId="request_12345678901234567890"; public int resolved; public JSObject result;
    public String getString(String key){return getString(key,null);} public String getString(String key,String fallback){return key.equals("placement")?placement:key.equals("requestId")?requestId:fallback;}
    public void resolve(JSObject value){resolved++;result=value;} }`,
  'com/my/target/common/MyTargetPrivacy.java': 'package com.my.target.common; public class MyTargetPrivacy { public static boolean consent=true; public static void setUserConsent(boolean c){consent=c;} }',
  'com/my/target/common/MyTargetConfig.java': `package com.my.target.common; public class MyTargetConfig {
    public boolean environment,location; public static class Builder {
      MyTargetConfig config=new MyTargetConfig();
      public Builder withTrackingEnvironment(boolean v){config.environment=v;return this;}
      public Builder withTrackingLocation(boolean v){config.location=v;return this;}
      public MyTargetConfig build(){return config;}
    } }`,
  'com/my/target/common/MyTargetManager.java': `package com.my.target.common; public class MyTargetManager {
    public static int initialized; public static MyTargetConfig config;
    public static void setSdkConfig(MyTargetConfig c){config=c;}
    public static void initSdk(android.content.Context c){initialized++;}
  }`,
  'com/my/target/common/models/IAdLoadingError.java': 'package com.my.target.common.models; public interface IAdLoadingError {}',
  'com/my/target/ads/Reward.java': 'package com.my.target.ads; public class Reward {}',
  'com/my/target/ads/RewardedAd.java': `package com.my.target.ads; public class RewardedAd {
    public static RewardedAd last; public static int created; public static boolean throwOnLoad;
    public RewardedAdListener listener; public int shows; public boolean destroyed;
    public RewardedAd(int slot,android.content.Context c){if(slot!=2111707)throw new AssertionError();last=this;created++;}
    public void setListener(RewardedAdListener l){listener=l;} public void load(){if(throwOnLoad)throw new IllegalStateException();}
    public void show(){shows++;} public void dismiss(){} public void destroy(){destroyed=true;}
    public interface RewardedAdListener {
      void onLoad(RewardedAd a); void onNoAd(com.my.target.common.models.IAdLoadingError e,RewardedAd a);
      void onFailedToShow(RewardedAd a); void onClick(RewardedAd a); void onDisplay(RewardedAd a);
      void onReward(Reward r,RewardedAd a); void onDismiss(RewardedAd a);
    } }`,
};

const harness = `package org.moongame.fixture;
import com.getcapacitor.*; import com.my.target.ads.*; import android.os.Handler;
public class RewardedHarness {
  static void check(boolean value){if(!value)throw new AssertionError();}
  static void outcome(PluginCall c,String expected){check(c.resolved==1);check(expected.equals(c.result.get("outcome")));check(Boolean.FALSE.equals(c.result.get("serverVerifiedRewards")));}
  public static void main(String[] args){
    VkRewardedAdsPlugin p=new VkRewardedAdsPlugin(); PluginCall c=new PluginCall();
    if(args[0].equals("status")){p.status(c);check(RewardedAd.created==0);check(com.my.target.common.MyTargetManager.initialized==0);check(c.result.get("slotId").equals(2111707));return;}
    if(args[0].equals("invalid")){c.placement="run.sovereigns";p.show(c);outcome(c,"unavailable");check(RewardedAd.created==0);return;}
    if(args[0].equals("remote")){android.webkit.WebView.url="https://example.com/";p.show(c);outcome(c,"unavailable");check(RewardedAd.created==0);return;}
    if(args[0].equals("background")){androidx.lifecycle.Lifecycle.resumed=false;p.show(c);outcome(c,"unavailable");check(RewardedAd.created==0);return;}
    if(args[0].equals("exception"))RewardedAd.throwOnLoad=true;
    p.show(c);RewardedAd a=RewardedAd.last;
    if(args[0].equals("exception")){outcome(c,"unavailable");check(a.destroyed);return;}
    check(!com.my.target.common.MyTargetPrivacy.consent);
    check(!com.my.target.common.MyTargetManager.config.environment && !com.my.target.common.MyTargetManager.config.location);
    RewardedAd.RewardedAdListener l=a.listener;
    switch(args[0]){
      case "earned":l.onLoad(a);l.onReward(new Reward(),a);l.onReward(new Reward(),a);check(c.resolved==0);l.onDismiss(a);l.onDismiss(a);outcome(c,"earned");break;
      case "cancelled":l.onLoad(a);l.onDismiss(a);l.onReward(new Reward(),a);outcome(c,"cancelled");break;
      case "duplicate-load":l.onLoad(a);l.onLoad(a);check(a.shows==1);l.onDismiss(a);outcome(c,"cancelled");break;
      case "no-ad":l.onNoAd(null,a);outcome(c,"unavailable");break;
      case "show-failed":l.onLoad(a);l.onFailedToShow(a);outcome(c,"unavailable");break;
      case "timeout":Handler.expire();l.onLoad(a);l.onReward(new Reward(),a);l.onDismiss(a);outcome(c,"unavailable");break;
      case "destroy":p.handleOnDestroy();l.onReward(new Reward(),a);l.onDismiss(a);outcome(c,"unavailable");break;
      case "parallel":PluginCall other=new PluginCall();p.show(other);outcome(other,"unavailable");check(c.resolved==0);l.onDismiss(a);outcome(c,"cancelled");break;
      case "stale":Handler.expire();PluginCall next=new PluginCall();p.show(next);l.onReward(new Reward(),a);l.onDismiss(a);check(next.resolved==0);RewardedAd.last.listener.onDismiss(RewardedAd.last);outcome(next,"cancelled");break;
      case "background-load":androidx.lifecycle.Lifecycle.resumed=false;l.onLoad(a);outcome(c,"unavailable");check(a.shows==0);break;
      case "early-reward":l.onReward(new Reward(),a);l.onDismiss(a);outcome(c,"cancelled");break;
      default:throw new AssertionError();
    }
    check(Handler.tasks.isEmpty());check(a.destroyed);
  }
}`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'vk-native-test-'));
  const sources = { ...stubs, 'org/moongame/fixture/RewardedHarness.java': harness,
    'org/moongame/fixture/VkRewardedAdsPlugin.java': readFileSync(new URL('./native/VkRewardedAdsPlugin.java', import.meta.url), 'utf8')
      .replaceAll('__APP_ID__', 'org.moongame.fixture').replaceAll('__SLOT_ID__', '2111707') };
  for (const [path, contents] of Object.entries(sources)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  const args = ['-m', 'jdk.compiler/com.sun.tools.javac.Main', '-d', join(dir, 'classes'), ...Object.keys(sources).map(p => join(dir, p))];
  execFileSync('java', args, { timeout: 30_000, stdio: 'pipe' });
}, 40_000);
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
it.each(['status', 'invalid', 'remote', 'background', 'exception', 'earned', 'cancelled', 'duplicate-load',
  'no-ad', 'show-failed', 'timeout', 'destroy', 'parallel', 'stale', 'background-load', 'early-reward'])(
  'native callback lifecycle: %s (SDK/Android test doubles, no network or entitlements)', scenario => {
    expect(() => execFileSync('java', ['-cp', join(dir, 'classes'), 'org.moongame.fixture.RewardedHarness', scenario],
      { timeout: 10_000, stdio: 'pipe' })).not.toThrow();
  },
);
