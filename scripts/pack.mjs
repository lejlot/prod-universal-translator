import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
fs.rmSync('universal-translator.ehpk', {force:true})
for (const args of [['node_modules/typescript/bin/tsc','--noEmit'],['node_modules/vite/bin/vite.js','build'],['node_modules/@evenrealities/evenhub-cli/main.js','pack','app.json','dist','-o','universal-translator.ehpk','--sdk-ver',JSON.parse(fs.readFileSync('node_modules/@evenrealities/even_hub_sdk/package.json')).version]]) {
  const result=spawnSync(process.execPath,args,{stdio:'inherit',windowsHide:true})
  if(result.error || result.status!==0) process.exit(result.status || 1)
}
const app=JSON.parse(fs.readFileSync('app.json'))
const pkg=JSON.parse(fs.readFileSync('package.json'))
const bytes=fs.readFileSync('universal-translator.ehpk')
if(app.version!==pkg.version || app.package_id!=='com.personal.g2hud' || bytes.length<32 || bytes.subarray(0,4).toString()!=='EHPK') throw Error('Invalid app package')
