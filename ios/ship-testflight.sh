#!/bin/bash
# Run through a Terminal .command in the Aqua login when headless codesign fails.
# Canonical procedure: ../../_factory/brain/playbooks/ios-testflight.md
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")"
python3 -u - <<'PY'
import datetime, json, os, plistlib, re, subprocess, time, urllib.request
from pathlib import Path
import jwt

root=Path.cwd()
vault=Path.home()/'.secrets/monorepo.env'
def value(name):
    for line in vault.read_text().splitlines():
        if line.startswith(name+'='):
            return line.split('=',1)[1].strip().strip('\"\'')
    raise SystemExit('Missing vault entry: '+name)
kid=value('ASC_KEY_ID');issuer=value('ASC_ISSUER_ID')
if not re.fullmatch(r'[A-Z0-9]+',kid): raise SystemExit('Invalid ASC key ID')
key=Path.home()/'.appstoreconnect/private_keys'/f'AuthKey_{kid}.p8'
if not key.is_file(): raise SystemExit('Missing ASC private key')
now=int(time.time())
token=jwt.encode({'iss':issuer,'iat':now,'exp':now+600,'aud':'appstoreconnect-v1'},key.read_text(),algorithm='ES256',headers={'kid':kid,'typ':'JWT'})
def asc(path):
    req=urllib.request.Request('https://api.appstoreconnect.apple.com/v1/'+path,headers={'Authorization':'Bearer '+token})
    with urllib.request.urlopen(req,timeout=30) as response: return json.load(response)
app=asc('apps/6809025615')['data']
assert app['attributes']['bundleId']=='com.curbnote.app'
build=re.search(r'CURRENT_PROJECT_VERSION: "(\d+)"',(root/'project.yml').read_text()).group(1)
existing=asc('builds?filter[app]=6809025615&filter[version]='+build)['data']
if existing: raise SystemExit('Build '+build+' already exists. Increment project.yml before shipping again.')
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
out=Path.home()/'.local/share/curbnote-releases'/('testflight-'+stamp)
out.mkdir(parents=True,exist_ok=False)
Path('/tmp/curbnote-active-ship-path').write_text(str(out))
archive=out/'Curbnote.xcarchive'
auth=['-allowProvisioningUpdates','-authenticationKeyPath',str(key),'-authenticationKeyID',kid,'-authenticationKeyIssuerID',issuer]
print('Shipping Curbnote build',build,'Artifacts:',out,flush=True)
subprocess.run(['xcodegen','generate'],check=True)
subprocess.run(['xcodebuild','-project','Unignorable.xcodeproj','-scheme','Unignorable','-destination','generic/platform=iOS','-derivedDataPath','/tmp/curbnote-device-derived','-archivePath',str(archive),'archive',*auth],check=True)
plist=plistlib.loads((archive/'Products/Applications/Unignorable.app/Info.plist').read_bytes())
assert plist['CFBundleIdentifier']=='com.curbnote.app'
assert plist['CFBundleDisplayName']=='Curbnote'
assert plist['CFBundleVersion']==build
assert plist['ITSAppUsesNonExemptEncryption'] is False
print('VERIFIED signed archive:',plist['CFBundleIdentifier'],plist['CFBundleShortVersionString'],build,flush=True)
options={'method':'app-store-connect','teamID':'99US464DK4','destination':'upload','signingStyle':'automatic','testFlightInternalTestingOnly':True,'manageAppVersionAndBuildNumber':False}
export=out/'ExportOptions.plist';export.write_bytes(plistlib.dumps(options))
subprocess.run(['xcodebuild','-exportArchive','-archivePath',str(archive),'-exportOptionsPlist',str(export),'-exportPath',str(out/'Export'),*auth],check=True)
(out/'uploaded.json').write_text(json.dumps({'appId':app['id'],'bundleId':plist['CFBundleIdentifier'],'version':plist['CFBundleShortVersionString'],'build':build,'uploadedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2)+'\n')
print('UPLOADED Curbnote build',build,flush=True)
PY
