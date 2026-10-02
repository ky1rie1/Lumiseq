//! Original ICC v2 matrix/TRC serialization for our sRGB encoded deliveries.
//! No external profile binary or editor source is incorporated. The v2 sampled
//! curve uses the black/white normalized sRGB convention described by ICC:
//! https://registry.color.org/rgb-registry/files/sRGB.pdf

fn fixed(value: f64) -> [u8; 4] {
    ((value * 65536.0).round() as i32).to_be_bytes()
}

fn xyz(values: [f64; 3]) -> Vec<u8> {
    let mut data = b"XYZ \0\0\0\0".to_vec();
    for value in values {
        data.extend_from_slice(&fixed(value));
    }
    data
}

fn description(text: &str) -> Vec<u8> {
    let mut data = b"desc\0\0\0\0".to_vec();
    data.extend_from_slice(&((text.len() + 1) as u32).to_be_bytes());
    data.extend_from_slice(text.as_bytes());
    data.push(0);
    // No Unicode or Macintosh descriptions in this ICC v2 textDescriptionType.
    data.extend_from_slice(&[0; 8 + 2 + 1 + 67]);
    data
}

#[derive(Debug,Clone,Copy,Default,serde::Serialize,serde::Deserialize)]
#[serde(rename_all="kebab-case")]
pub enum OutputProfile {#[default] Srgb,DisplayP3}

impl OutputProfile {
    pub fn convert(self,rgb:[f32;3])->[f32;3] {
        match self {
            Self::Srgb=>rgb,
            Self::DisplayP3=>[
                0.82246196*rgb[0]+0.17753804*rgb[1],
                0.03319420*rgb[0]+0.96680580*rgb[1],
                0.01708263*rgb[0]+0.07239744*rgb[1]+0.91051993*rgb[2],
            ],
        }
    }
    pub fn icc(self,linear:bool)->Vec<u8> {rgb_icc_profile(matches!(self,Self::DisplayP3),linear)}
}

fn rgb_icc_profile(p3:bool,linear_trc:bool) -> Vec<u8> {
    let mut curve = b"curv\0\0\0\0".to_vec();
    const SAMPLES: u32 = 4096;
    curve.extend_from_slice(&SAMPLES.to_be_bytes());
    for i in 0..SAMPLES {
        let encoded = i as f64 / (SAMPLES - 1) as f64;
        let linear = if linear_trc {encoded} else if encoded <= 0.04045 {
            encoded / 12.92
        } else {
            ((encoded + 0.055) / 1.055).powf(2.4)
        };
        curve.extend_from_slice(&((linear * 65535.0).round() as u16).to_be_bytes());
    }
    let mut copyright = b"text\0\0\0\0".to_vec();
    copyright.extend_from_slice(b"Copyright AI Creative Studio Team. MIT License.\0");
    let mut adaptation = b"sf32\0\0\0\0".to_vec();
    for value in [
        1.047844353856414,
        0.022898981050086,
        -0.050206647741605,
        0.029549007606644,
        0.990508028941971,
        -0.017074711360960,
        -0.009250984365223,
        0.015072338237051,
        0.751717835079977,
    ] {
        adaptation.extend_from_slice(&fixed(value));
    }
    let primaries=if p3 {
        // Display P3 D65 primaries adapted to the same D50 PCS used above.
        let d65=[[0.4865709486482162,0.2289745640697488,0.0],
            [0.2656676931690931,0.6917385218365064,0.0451133818589026],
            [0.1982172852343625,0.0792869140937450,1.043944368900976]];
        let bradford=[[1.047844353856414,0.022898981050086,-0.050206647741605],
            [0.029549007606644,0.990508028941971,-0.017074711360960],
            [-0.009250984365223,0.015072338237051,0.751717835079977]];
        d65.map(|xyz|std::array::from_fn(|r|(0..3).map(|c|bradford[r][c]*xyz[c]).sum()))
    } else {
        [[0.436030342570117,0.222438466210245,0.013897440074263],
            [0.385101860087134,0.716942745571917,0.097076381494207],
            [0.143067806654203,0.060618777416563,0.713926257896652]]
    };
    let name=match (p3,linear_trc) {
        (true,false)=>"Lumiseq Display P3",(true,true)=>"Lumiseq Linear Display P3",
        (false,true)=>"Lumiseq Linear sRGB",(false,false)=>"Lumiseq sRGB IEC61966-2.1",
    };
    let tags: Vec<(&[u8; 4], Vec<u8>)> = vec![
        (b"desc", description(name)),
        (b"cprt", copyright),
        (b"wtpt", xyz([0.9642, 1.0, 0.8249])),
        (b"bkpt", xyz([0.0; 3])),
        (b"chad", adaptation),
        // D65 sRGB primaries adapted to ICC D50 PCS (ICC sRGB guidance).
        (
            b"rXYZ",
            xyz(primaries[0]),
        ),
        (
            b"gXYZ",
            xyz(primaries[1]),
        ),
        (
            b"bXYZ",
            xyz(primaries[2]),
        ),
        (b"rTRC", curve.clone()),
        (b"gTRC", curve.clone()),
        (b"bTRC", curve),
    ];
    let mut profile = vec![0; 132 + tags.len() * 12];
    profile[8..12].copy_from_slice(&0x02400000u32.to_be_bytes());
    profile[12..16].copy_from_slice(b"mntr");
    profile[16..20].copy_from_slice(b"RGB ");
    profile[20..24].copy_from_slice(b"XYZ ");
    for (i, value) in [2026u16, 9, 29, 0, 0, 0].into_iter().enumerate() {
        profile[24 + i * 2..26 + i * 2].copy_from_slice(&value.to_be_bytes());
    }
    profile[36..40].copy_from_slice(b"acsp");
    profile[64..68].copy_from_slice(&1u32.to_be_bytes()); // relative colorimetric
    for (i, value) in [0.9642, 1.0, 0.8249].into_iter().enumerate() {
        profile[68 + i * 4..72 + i * 4].copy_from_slice(&fixed(value));
    }
    profile[80..84].copy_from_slice(b"LMSQ");
    profile[128..132].copy_from_slice(&(tags.len() as u32).to_be_bytes());
    let mut written: Vec<(Vec<u8>, usize)> = Vec::new();
    for (i, (signature, data)) in tags.into_iter().enumerate() {
        let offset = if let Some((_, offset)) = written.iter().find(|(prior, _)| *prior == data) {
            *offset
        } else {
            let offset = profile.len();
            profile.extend_from_slice(&data);
            while profile.len() % 4 != 0 {
                profile.push(0);
            }
            written.push((data.clone(), offset));
            offset
        };
        let record = &mut profile[132 + i * 12..144 + i * 12];
        record[..4].copy_from_slice(signature);
        record[4..8].copy_from_slice(&(offset as u32).to_be_bytes());
        record[8..12].copy_from_slice(&(data.len() as u32).to_be_bytes());
    }
    let size = profile.len() as u32;
    profile[..4].copy_from_slice(&size.to_be_bytes());
    profile
}
