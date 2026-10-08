#!/bin/sh
# ทดสอบ Office Scripts แบบออฟไลน์ (ต้องมี node + tsc):  sh sharepoint-app/test/run.sh
set -e
D=$(cd "$(dirname "$0")" && pwd); O=$(mktemp -d)
tsc --strict --target es2017 --lib es2017 --outDir "$O" "$D/excelscript.d.ts" "$D/../import-roster.ts"
echo "module.exports={main,dateFromPath};" >> "$O/import-roster.js"
node "$D/date-path.test.js" "$O/import-roster.js"
node "$D/ot.test.js" "$O/import-roster.js"
node "$D/datacheck.test.js" "$O/import-roster.js"
tsc --strict --target es2017 --lib es2017 --outDir "$O/m" "$D/excelscript.d.ts" "$D/../import-master.ts"
echo "module.exports={main};" >> "$O/m/import-master.js"
node "$D/master.test.js" "$O/m/import-master.js"
tsc --strict --target es2017 --lib es2017 --outDir "$O/p" "$D/excelscript.d.ts" "$D/../import-porter.ts"
echo "module.exports={main};" >> "$O/p/import-porter.js"
node "$D/porter.test.js" "$O/p/import-porter.js"
tsc --strict --target es2017 --lib es2017 --outDir "$O/f" "$D/excelscript.d.ts" "$D/../import-flights.ts"
echo "module.exports={main};" >> "$O/f/import-flights.js"
node "$D/flights.test.js" "$O/f/import-flights.js"
echo "module.exports.computeSla=computeSla;" >> "$O/import-roster.js"
node "$D/sla-parity.test.js" "$O/import-roster.js"
echo "module.exports.acAnalyzeRec=acAnalyzeRec;module.exports.acOwnerTeams=acOwnerTeams;" >> "$O/import-roster.js"
node "$D/assign-parity.test.js" "$O/import-roster.js"
