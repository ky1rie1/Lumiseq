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

pub(super) fn srgb_icc_profile() -> Vec<u8> {
    let mut curve = b"curv\0\0\0\0".to_vec();
    const SAMPLES: u32 = 4096;
    curve.extend_from_slice(&SAMPLES.to_be_bytes());
    for i in 0..SAMPLES {
        let encoded = i as f64 / (SAMPLES - 1) as f64;
        let linear = if encoded <= 0.04045 {
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
    let tags: Vec<(&[u8; 4], Vec<u8>)> = vec![
        (b"desc", description("Lumiseq sRGB IEC61966-2.1")),
        (b"cprt", copyright),
        (b"wtpt", xyz([0.9642, 1.0, 0.8249])),
        (b"bkpt", xyz([0.0; 3])),
        (b"chad", adaptation),
        // D65 sRGB primaries adapted to ICC D50 PCS (ICC sRGB guidance).
        (
            b"rXYZ",
            xyz([0.436030342570117, 0.222438466210245, 0.013897440074263]),
        ),
        (
            b"gXYZ",
            xyz([0.385101860087134, 0.716942745571917, 0.097076381494207]),
        ),
        (
            b"bXYZ",
            xyz([0.143067806654203, 0.060618777416563, 0.713926257896652]),
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
