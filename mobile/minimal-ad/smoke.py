"""An offline emulator checks the real installed UI without requesting paid ads."""
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET


def adb(*args):
    return subprocess.check_output(['adb', *args], timeout=25, text=True).strip()


def screen():
    adb('shell', 'uiautomator', 'dump', '/sdcard/ad-probe-ui.xml')
    return ET.fromstring(adb('exec-out', 'cat', '/sdcard/ad-probe-ui.xml'))


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
adb('install', '-r', sys.argv[1])
# AOSP emulator only: block this application's IPv4/IPv6 traffic even if a
# virtual Ethernet interface survives the Wi-Fi/mobile-data switches.
adb('root')
adb('wait-for-device')
uid_match = re.search(r'\buid:(\d+)', adb('shell', 'cmd', 'package', 'list', 'packages', '-U', 'com.voiddominion.player'))
assert uid_match and 10000 <= int(uid_match[1]) < 100000, 'E_PROBE_UID'
for firewall in ['iptables', 'ip6tables']:
    adb('shell', firewall, '-I', 'OUTPUT', '-m', 'owner', '--uid-owner', uid_match[1], '-j', 'REJECT')
adb('shell', 'am', 'start', '-W', '-n', 'com.voiddominion.player/.AdProbeActivity')
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
        print('Installed native APK: one button, no game WebView, explicit tap returns a bounded offline error, retry enabled.')
        break
    time.sleep(3)
else:
    raise RuntimeError('E_PROBE_BUTTON_RESULT')
