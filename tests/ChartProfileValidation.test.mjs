import {it,expect} from 'vitest';
import {assertSrgbProfile} from '../scripts/chart-validation/icc.mjs';

function profile() {
 const values={rXYZ:[.43603034257,.22243846621,.01389744007],gXYZ:[.38510186009,.71694274557,.09707638149],
  bXYZ:[.14306780665,.06061877742,.7139262579],wtpt:[.9642,1,.8249]};
 const blocks=Object.entries(values).map(([name,xyz])=>{
  const data=Buffer.alloc(20);data.write('XYZ ');xyz.forEach((v,i)=>data.writeInt32BE(Math.round(v*65536),8+i*4));return [name,data];
 });
 const curve=Buffer.alloc(12+4096*2);curve.write('curv');curve.writeUInt32BE(4096,8);
 for(let i=0;i<4096;i++) {const x=i/4095,y=x<=.04045?x/12.92:((x+.055)/1.055)**2.4;curve.writeUInt16BE(Math.round(y*65535),12+i*2);}
 for(const name of ['rTRC','gTRC','bTRC']) blocks.push([name,curve]);
 const header=Buffer.alloc(132+blocks.length*12);header.write('acsp',36);header.write('RGB ',16);header.write('XYZ ',20);header.writeUInt32BE(blocks.length,128);
 let offset=header.length;
 blocks.forEach(([name,data],i)=>{header.write(name,132+i*12);header.writeUInt32BE(offset,136+i*12);header.writeUInt32BE(data.length,140+i*12);offset+=data.length;});
 header.writeUInt32BE(offset,0);return Buffer.concat([header,...blocks.map(([,data])=>data)]);
}
it('validates all primaries and sampled transfer functions before measuring tagged sRGB',()=>{
 expect(()=>assertSrgbProfile(profile())).not.toThrow();
 const p3=profile();p3.writeInt32BE(Math.round(.515*65536),p3.readUInt32BE(136)+8);
 expect(()=>assertSrgbProfile(p3)).toThrow(/profile/);
 const trc=profile();trc.writeUInt16BE(0,trc.readUInt32BE(136+4*12)+12+2048*2);
 expect(()=>assertSrgbProfile(trc)).toThrow(/profile/);
 const bounds=profile();bounds.writeUInt32BE(0xffffffff,136);
 expect(()=>assertSrgbProfile(bounds)).toThrow(/profile/);
 const lut=profile();lut.write('A2B0',132);
 expect(()=>assertSrgbProfile(lut)).toThrow(/profile/);
});
