use super::types::RawError;

/// Output pixel centres map back into the full demosaiced camera frame. Sony's
/// signed fixed-point tables describe radial scale, CA scale and light falloff.
pub(super) struct OpticalMapping {
    width: usize,
    height: usize,
    crop: [usize;4],
    distortion: Vec<f32>,
    red: Vec<f32>,
    blue: Vec<f32>,
    shading: Vec<f32>,
    zoom: f32,
}

fn table(values: &[i16], paired: bool) -> Result<Vec<i16>,RawError> {
    let count=values[0] as usize;
    if count==0 {return Ok(Vec::new());}
    if !(2..=16).contains(&(if paired {count/2} else {count}))
        || (paired && count%2!=0) || count+1>values.len() {
        return Err(RawError::DecodeFailed("Invalid Sony optical table".into()));
    }
    Ok(values[1..=count].to_vec())
}

fn radial(values: &[f32], radius: f32) -> f32 {
    if values.is_empty() {return 1.0;}
    let position=(radius*(values.len()-1) as f32-0.5).clamp(0.0,(values.len()-1) as f32);
    let low=position.floor() as usize;
    let high=(low+1).min(values.len()-1);
    values[low]+(values[high]-values[low])*(position-low as f32)
}

impl OpticalMapping {
    pub fn new(width:usize,height:usize,crop:[usize;4],distortion:&[i16;17],ca:&[i16;33],shading:&[i16;17]) -> Result<Self,RawError> {
        if width==0 || height==0 || crop[2]==0 || crop[3]==0
            || crop[0].checked_add(crop[2]).is_none_or(|end|end>width)
            || crop[1].checked_add(crop[3]).is_none_or(|end|end>height) {
            return Err(RawError::DecodeFailed("Invalid camera active crop".into()));
        }
        let distortion:Vec<f32>=table(distortion,false)?.into_iter().map(|n|1.0+n as f32/16384.0).collect();
        let aberration=table(ca,true)?;
        let (red,blue)=aberration.split_at(aberration.len()/2);
        let shading:Vec<f32>=table(shading,false)?.into_iter().map(|n|2.0f32.powf(0.5-2.0f32.powf(n as f32/8192.0-1.0))).collect();
        if distortion.iter().any(|v|*v<0.5 || *v>2.0)
            || shading.iter().any(|v|!v.is_finite() || *v<0.05 || *v>4.0) {
            return Err(RawError::DecodeFailed("Unsafe camera optical calibration".into()));
        }
        let mut mapping=Self {width,height,crop,distortion,shading,zoom:1.0,
            red:red.iter().map(|n|1.0+*n as f32/2097152.0).collect(),
            blue:blue.iter().map(|n|1.0+*n as f32/2097152.0).collect()};
        if !mapping.border_fits() {
            // Bound every radial segment, including CA, before cropping the field
            // of view. Output dimensions remain stable; no border pixels are invented.
            let maximum=|values:&[f32]|values.iter().copied().fold(1.0f32,f32::max);
            let scale=maximum(&mapping.distortion)*maximum(&mapping.red).max(maximum(&mapping.blue));
            let cx=(width-1) as f32*0.5; let cy=(height-1) as f32*0.5;
            let ox=crop[0] as f32+(crop[2]-1) as f32*0.5;
            let oy=crop[1] as f32+(crop[3]-1) as f32*0.5;
            let zx=(cx/scale-(ox-cx).abs())/((crop[2]-1) as f32*0.5).max(1.0);
            let zy=(cy/scale-(oy-cy).abs())/((crop[3]-1) as f32*0.5).max(1.0);
            mapping.zoom=zx.min(zy).min(1.0)*0.999999;
            if mapping.zoom<=0.0 || !mapping.border_fits() {
                return Err(RawError::DecodeFailed("Camera optical crop cannot fit sensor frame".into()));
            }
        }
        Ok(mapping)
    }
    pub fn dimensions(&self)->(usize,usize) {(self.crop[2],self.crop[3])}
    fn radius(&self,x:f32,y:f32)->f32 {
        let cx=(self.width-1) as f32*0.5;
        let cy=(self.height-1) as f32*0.5;
        ((x-cx).hypot(y-cy)/cx.hypot(cy).max(1.0)).max(0.0)
    }
    pub fn map(&self,x:f32,y:f32,channel:usize)->(f32,f32) {
        let ox=(self.crop[2]-1) as f32*0.5;
        let oy=(self.crop[3]-1) as f32*0.5;
        let x=ox+(x-ox)*self.zoom+self.crop[0] as f32;
        let y=oy+(y-oy)*self.zoom+self.crop[1] as f32;
        if self.distortion.is_empty() && self.red.is_empty() && self.blue.is_empty() {return (x,y);}
        let radius=self.radius(x,y);
        let ca=match channel {0=>radial(&self.red,radius),2=>radial(&self.blue,radius),_=>1.0};
        let scale=radial(&self.distortion,radius)*ca;
        let cx=(self.width-1) as f32*0.5;
        let cy=(self.height-1) as f32*0.5;
        (cx+(x-cx)*scale,cy+(y-cy)*scale)
    }
    pub fn shading_gain(&self,x:f32,y:f32)->f32 {
        if self.shading.is_empty() {1.0} else {1.0/radial(&self.shading,self.radius(x,y))}
    }
    fn border_fits(&self)->bool {
        let fits=|x:f32,y:f32|(0..3).all(|c| {
            let (sx,sy)=self.map(x,y,c);
            sx>=0.0 && sy>=0.0 && sx<=(self.width-1) as f32 && sy<=(self.height-1) as f32
        });
        (0..self.crop[2]).all(|x|fits(x as f32,0.0)&&fits(x as f32,(self.crop[3]-1) as f32))
            && (0..self.crop[3]).all(|y|fits(0.0,y as f32)&&fits((self.crop[2]-1) as f32,y as f32))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sony_tables_map_corners_inward_and_keep_center_and_crop() {
        let mut distortion=[0i16;17]; distortion[0]=11;
        distortion[1..12].copy_from_slice(&[43,-7,-115,-244,-431,-647,-906,-1179,-1481,-1775,-2077]);
        let mut shading=[0i16;17]; shading[0]=11;
        shading[1..12].copy_from_slice(&[0,320,832,1408,2048,2496,3328,5056,7360,10112,13120]);
        let model=OpticalMapping::new(6240,4168,[26,20,6192,4128],&distortion,&[0;33],&shading).unwrap();
        assert_eq!(model.dimensions(),(6192,4128));
        let center=model.map(3095.5,2063.5,1);
        assert!((center.0-3121.5).abs()<0.01 && (center.1-2083.5).abs()<0.01);
        for (x,y) in [(0.,0.),(6191.,0.),(0.,4127.),(6191.,4127.)] {
            let (sx,sy)=model.map(x,y,1);
            assert!(sx>100. && sx<6140. && sy>100. && sy<4068.);
            assert!(model.shading_gain(sx,sy)>1.3);
        }
        assert!(OpticalMapping::new(6240,4168,[100,0,6240,4168],&distortion,&[0;33],&shading).is_err());
        distortion[0]=17;
        assert!(OpticalMapping::new(6240,4168,[26,20,6192,4128],&distortion,&[0;33],&shading).is_err());
    }
    #[test]
    fn identity_mapping_never_resizes_or_changes_sensor_samples() {
        let model=OpticalMapping::new(4,3,[0,0,4,3],&[0;17],&[0;33],&[0;17]).unwrap();
        for y in 0..3 {for x in 0..4 {
            assert_eq!(model.map(x as f32,y as f32,0),(x as f32,y as f32));
            assert_eq!(model.shading_gain(x as f32,y as f32),1.0);
        }}
    }
    #[test]
    fn pincushion_and_ca_crop_to_real_sensor_pixels() {
        let mut distortion=[0;17]; distortion[0]=3; distortion[1..4].copy_from_slice(&[10,400,1200]);
        let mut ca=[0;33]; ca[0]=6; ca[1..7].copy_from_slice(&[200,500,900,-100,100,300]);
        let mapping=OpticalMapping::new(400,300,[0,0,400,300],&distortion,&ca,&[0;17]).unwrap();
        assert_eq!(mapping.dimensions(),(400,300));
        assert!(mapping.zoom<1.0);
        for y in 0..300 {for x in 0..400 {for c in 0..3 {
            let (sx,sy)=mapping.map(x as f32,y as f32,c);
            assert!(sx>=0.0 && sx<=399.0 && sy>=0.0 && sy<=299.0);
        }}}
    }
}
