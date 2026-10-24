// Append inside the existing Game HTTPS site. The root must contain public APKs only.
export function apkIngress(root='/srv/moongame-apk') {
  if(!/^\/[a-zA-Z0-9_/-]+$/.test(root)||root.includes('..'))throw new Error('E_APK_INGRESS');
  return `
    # BEGIN MOONGAME APK DISTRIBUTION
    handle_path /downloads/android/* {
        header {
            Access-Control-Allow-Origin "*"
            X-Content-Type-Options "nosniff"
            Cache-Control "no-store"
        }
        @alias path_regexp apkAlias ^/(alpha|player)/(latest\\.json|latest\\.apk)$
        rewrite @alias /{re.apkAlias.1}/current/{re.apkAlias.2}
        @apk path *.apk
        header @apk Content-Type application/vnd.android.package-archive
        header @apk Content-Disposition "attachment; filename=void-dominion.apk"
        file_server {
            root ${root}
        }
    }
    # END MOONGAME APK DISTRIBUTION
`;
}
