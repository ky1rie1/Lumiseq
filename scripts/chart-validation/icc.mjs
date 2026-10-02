// Validate matrix/TRC sRGB profiles before treating tagged samples as sRGB.
// Other profiles require their actual transform rather than an sRGB assumption.
export function assertSrgbProfile(profile) {
  const fail=()=>{throw new Error('Embedded color profile is not a supported matrix/TRC sRGB profile');};
  if (profile.length<132 || profile.readUInt32BE(0)!==profile.length || profile.toString('ascii',36,40)!=='acsp'
    || profile.toString('ascii',16,20)!=='RGB ' || profile.toString('ascii',20,24)!=='XYZ ') fail();
  const count=profile.readUInt32BE(128),start=132+count*12;
  if (count>128 || start>profile.length) fail();
  const tags=new Map();
  for(let i=0;i<count;i++) {
    const pos=132+i*12,tag=profile.toString('ascii',pos,pos+4),offset=profile.readUInt32BE(pos+4),length=profile.readUInt32BE(pos+8);
    if(tags.has(tag) || offset<start || length<8 || offset+length>profile.length || /^(A2B|B2A|D2B|B2D)/.test(tag)) fail();
    tags.set(tag,profile.subarray(offset,offset+length));
  }
  const xyz=(tag,expected)=>{
    const data=tags.get(tag);
    if(!data || data.length!==20 || data.toString('ascii',0,4)!=='XYZ ') fail();
    expected.forEach((value,i)=>{if(Math.abs(data.readInt32BE(8+i*4)/65536-value)>0.00005)fail();});
  };
  xyz('rXYZ',[.43603034257,.22243846621,.01389744007]);
  xyz('gXYZ',[.38510186009,.71694274557,.09707638149]);
  xyz('bXYZ',[.14306780665,.06061877742,.7139262579]);
  xyz('wtpt',[.9642,1,.8249]);
  for(const tag of ['rTRC','gTRC','bTRC']) {
    const data=tags.get(tag);
    if(!data || data.length<12 || data.toString('ascii',0,4)!=='curv') fail();
    const samples=data.readUInt32BE(8);
    if(samples<1024 || samples>65536 || data.length!==12+samples*2) fail();
    for(let i=0;i<samples;i++) {
      const code=i/(samples-1),linear=code<=.04045?code/12.92:((code+.055)/1.055)**2.4;
      if(Math.abs(data.readUInt16BE(12+i*2)/65535-linear)>1/65535) fail();
    }
  }
}
