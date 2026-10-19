import { describe,it,expect } from 'vitest';
import { verifyCertificate } from '../../mobile/apk-verify.mjs';
const cert='b'.repeat(64);
describe('sideload signing identity across Android build-tools versions',()=>{
  it.each(['Signer #1','V3.0 Signer:'])('accepts one pinned signer: %s',label=>{
    const output=`Number of signers: 1\n${label} certificate SHA-256 digest: ${cert}\n`;
    expect(()=>verifyCertificate(output,cert)).not.toThrow();
    for(const bad of [output.replace('signers: 1','signers: 2'),output.replace(cert,'c'.repeat(64)),output.replace(label,'Unknown signer'),output.replace('Number of signers: 1\n',''),output+`Signer #2 certificate SHA-256 digest: ${cert}\n`])expect(()=>verifyCertificate(bad,cert)).toThrow('E_APK_SIGNER');
  });
  it('accepts repeated same certificate across schemes, not key rotation',()=>{
    const output=`Number of signers: 1\nV3.0 Signer: certificate SHA-256 digest: ${cert}\nV2 Signer: certificate SHA-256 digest: ${cert}\n`;
    expect(()=>verifyCertificate(output,cert)).not.toThrow();
    expect(()=>verifyCertificate(output.replace(`V2 Signer: certificate SHA-256 digest: ${cert}`,`V2 Signer: certificate SHA-256 digest: ${'c'.repeat(64)}`),cert)).toThrow();
  });
});
