// src-tauri/src/raw/ffi/libraw_wrapper.cpp
#include "libraw_wrapper.h"
#include <libraw/libraw.h>
#include <cstring>
#include <cstdlib>
#include <cmath>
#include <fstream>
#include <vector>
#include <mutex>
#include <algorithm>
#include <cctype>
#include <gpr.h>

namespace {
// Keep converted sensor DNG alive for the entire LibRaw open/unpack/process call.
struct GprBacking {
    gpr_buffer dng = {nullptr, 0};
    ~GprBacking() { free(dng.buffer); }
};
std::mutex gpr_mutex;

void optical_tag(void* context, int full_tag, int type, int length, unsigned order, void* input, INT64) {
    const int tag=full_tag & 0xffff;
    auto& optics=*static_cast<LibRawOptics*>(context);
    int16_t* target=nullptr;
    if (tag==0x7032 && length==17) target=optics.shading;
    if (tag==0x7035 && length==33) target=optics.aberration;
    if (tag==0x7037 && length==17) target=optics.distortion;
    if (!target || (type!=3 && type!=8)) return;
    auto& stream=*static_cast<LibRaw_abstract_datastream*>(input);
    const auto position=stream.tell();
    unsigned char bytes[66];
    if (position<0 || position+length*2>stream.size()) return;
    const int read=stream.read(bytes,1,length*2);
    stream.seek(position,SEEK_SET);
    if (read!=length*2) return;
    for (int i=0;i<length;++i) {
        const unsigned value=order==0x4949 ? bytes[i*2] | (bytes[i*2+1]<<8) : (bytes[i*2]<<8) | bytes[i*2+1];
        target[i]=static_cast<int16_t>(value);
    }
}

void active_crop(LibRaw& raw, LibRawOptics& optics) {
    const auto& s=raw.imgdata.sizes;
    // Sony ARW defines this crop in its uncropped visible camera frame.
    if (strncmp(raw.imgdata.idata.make,"Sony",4)) return;
    const auto& c=s.raw_inset_crops[0];
    if (c.cwidth && c.cheight && uint32_t(c.cleft)+c.cwidth<=s.width && uint32_t(c.ctop)+c.cheight<=s.height) {
        optics.crop[0]=c.cleft; optics.crop[1]=c.ctop;
        optics.crop[2]=c.cwidth; optics.crop[3]=c.cheight;
    }
}

class SceneRaw : public LibRaw {
public:
    LibRawSceneCalibration* calibration = nullptr;
    void configure_scene(LibRawSceneCalibration* value) {
        calibration = value;
        set_exifparser_handler(optical_tag, &calibration->optics);
        callbacks.pre_scalecolors_cb = [](void* context) {
            auto& raw = *static_cast<SceneRaw*>(static_cast<LibRaw*>(context));
            auto& c = raw.imgdata.color;
            auto& out = *raw.calibration;
            out.normalization = c.maximum>c.black ? static_cast<float>(c.maximum - c.black) : 0.f;
            // The decoder owns per-pixel black subtraction. WB and RGB conversion
            // remain outside its integer pipeline, including Nikon's pre-balanced sRAW.
            float minimum = 1e30f;
            for (int i=0; i<4; ++i) {
                float wb = c.as_shot_wb_applied ? 1.f : c.cam_mul[i];
                if (!(wb > 0.f) || !std::isfinite(wb)) wb = c.pre_mul[i];
                if (!(wb > 0.f) || !std::isfinite(wb)) wb = i == 3 ? out.multipliers[1] : 1.f;
                out.multipliers[i] = wb;
                if (i<raw.imgdata.idata.colors) minimum = std::min(minimum, wb);
            }
            for (int i=0; i<4; ++i) out.multipliers[i] /= minimum;
            memcpy(out.matrix, c.rgb_cam, sizeof(out.matrix));
        };
    }
};

int open_camera_raw(LibRaw& raw, const char* path, GprBacking& backing, bool sensor_decode = false) {
    int ret = raw.open_file(path);
    // GPR's DNG metadata opens successfully even when VC5 unpacking is unavailable.
    if (ret == LIBRAW_SUCCESS && !sensor_decode) return ret;
    if (ret != LIBRAW_SUCCESS && ret != LIBRAW_FILE_UNSUPPORTED) return ret;
    std::string name(path);
    std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c){ return std::tolower(c); });
    if (name.size() < 4 || name.substr(name.size()-4) != ".gpr") return ret;
    // The SDK preserves CFA sensor samples and metadata in an uncompressed DNG.
    // No RGB/JPEG fallback, temporary file, network or external process is used.
    try {
        std::ifstream file(path, std::ios::binary | std::ios::ate);
        const auto size = file.tellg();
        if (!file || size <= 0 || size > 512*1024*1024) return LIBRAW_IO_ERROR;
        std::vector<char> bytes(static_cast<size_t>(size));
        file.seekg(0); if (!file.read(bytes.data(), size)) return LIBRAW_IO_ERROR;
        gpr_buffer input = {bytes.data(), bytes.size()};
        gpr_allocator allocator = {malloc, free};
        std::lock_guard<std::mutex> lock(gpr_mutex);
        gpr_parameters parameters;
        gpr_parameters_set_defaults(&parameters);
        struct ParametersOwner {
            gpr_parameters* value;
            ~ParametersOwner() { gpr_parameters_destroy(value, free); }
        } owner{&parameters};
        if (!gpr_parse_metadata(&allocator, &input, &parameters)) return LIBRAW_FILE_UNSUPPORTED;
        if (!parameters.input_width || !parameters.input_height ||
            static_cast<uint64_t>(parameters.input_width)*parameters.input_height > 150000000) return LIBRAW_DATA_ERROR;
        if (!gpr_convert_gpr_to_dng(&allocator, &parameters, &input, &backing.dng)
            || !backing.dng.buffer || !backing.dng.size) return LIBRAW_DATA_ERROR;
        raw.recycle();
        raw.imgdata.params.use_camera_wb = 1;
        return raw.open_buffer(backing.dng.buffer, backing.dng.size);
    } catch (...) { return LIBRAW_DATA_ERROR; }
}
}

extern "C" {

int libraw_wrapper_get_metadata(const char* file_path, LibRawMetaResult* out_meta) {
    if (!file_path || !out_meta) return -1;
    memset(out_meta, 0, sizeof(LibRawMetaResult));

    GprBacking backing;
    LibRaw raw;
    raw.set_exifparser_handler(optical_tag,&out_meta->optics);
    // LibRaw derives use_camera_matrix from use_camera_wb while opening the
    // file, so this must be configured before open_file(), not before only
    // dcraw_process().
    raw.imgdata.params.use_camera_wb = 1;
    int ret = open_camera_raw(raw, file_path, backing);
    if (ret != LIBRAW_SUCCESS) {
        out_meta->error_code = ret;
        return ret;
    }

    strncpy(out_meta->make, raw.imgdata.idata.make, sizeof(out_meta->make) - 1);
    strncpy(out_meta->model, raw.imgdata.idata.model, sizeof(out_meta->model) - 1);
    out_meta->width = raw.imgdata.sizes.width;
    out_meta->height = raw.imgdata.sizes.height;
    out_meta->raw_width = raw.imgdata.sizes.raw_width;
    out_meta->raw_height = raw.imgdata.sizes.raw_height;
    out_meta->flip = raw.imgdata.sizes.flip;
    out_meta->colors = raw.imgdata.idata.colors;
    out_meta->bits_per_sample = raw.imgdata.color.maximum > 0 ? (uint32_t)ceil(log2(raw.imgdata.color.maximum + 1.0)) : 14;

    for (int i = 0; i < 4; i++) {
        out_meta->cam_mul[i] = raw.imgdata.color.cam_mul[i];
        out_meta->pre_mul[i] = raw.imgdata.color.pre_mul[i];
    }
    for (int r = 0; r < 3; r++) {
        for (int c = 0; c < 4; c++) {
            out_meta->cmatrix[r][c] = raw.imgdata.color.cmatrix[r][c];
            out_meta->rgb_cam[r][c] = raw.imgdata.color.rgb_cam[r][c];
        }
    }
    for (int i = 0; i < 4; i++) {
        out_meta->black_levels[i] = raw.imgdata.color.black + raw.imgdata.color.cblack[i];
    }
    out_meta->white_level = raw.imgdata.color.maximum;
    active_crop(raw,out_meta->optics);

    out_meta->has_thumb = raw.imgdata.thumbnail.tlength > 0 ? 1 : 0;
    out_meta->thumb_width = raw.imgdata.thumbnail.twidth;
    out_meta->thumb_height = raw.imgdata.thumbnail.theight;

    raw.recycle();
    return LIBRAW_SUCCESS;
}

int libraw_wrapper_extract_thumbnail(const char* file_path, LibRawThumbResult* out_thumb) {
    if (!file_path || !out_thumb) return -1;
    memset(out_thumb, 0, sizeof(LibRawThumbResult));

    GprBacking backing;
    LibRaw raw;
    int ret = open_camera_raw(raw, file_path, backing);
    if (ret != LIBRAW_SUCCESS) {
        out_thumb->error_code = ret;
        return ret;
    }

    ret = raw.unpack_thumb();
    if (ret != LIBRAW_SUCCESS) {
        out_thumb->error_code = ret;
        raw.recycle();
        return ret;
    }

    libraw_processed_image_t* thumb_img = raw.dcraw_make_mem_thumb(&ret);
    if (!thumb_img || ret != LIBRAW_SUCCESS) {
        out_thumb->error_code = ret;
        raw.recycle();
        return ret;
    }

    out_thumb->data_size = thumb_img->data_size;
    out_thumb->data = (uint8_t*)malloc(thumb_img->data_size);
    if (out_thumb->data) {
        memcpy(out_thumb->data, thumb_img->data, thumb_img->data_size);
    }
    out_thumb->is_jpeg = (thumb_img->type == LIBRAW_IMAGE_JPEG) ? 1 : 0;

    raw.dcraw_clear_mem(thumb_img);
    raw.recycle();
    if (!out_thumb->data) {
        out_thumb->error_code=LIBRAW_UNSUFFICIENT_MEMORY;
        return LIBRAW_UNSUFFICIENT_MEMORY;
    }
    return LIBRAW_SUCCESS;
}

void libraw_wrapper_free_thumb(LibRawThumbResult* thumb) {
    if (thumb && thumb->data) {
        free(thumb->data);
        thumb->data = NULL;
        thumb->data_size = 0;
    }
}

static int decode_processed(const char* file_path, int demosaic_quality, LibRawDecodedImage* out_image, LibRawSceneCalibration* calibration) {
    if (!file_path || !out_image) return -1;
    memset(out_image, 0, sizeof(LibRawDecodedImage));

    GprBacking backing;
    SceneRaw raw;
    if (calibration) {memset(calibration, 0, sizeof(*calibration)); raw.configure_scene(calibration);}
    raw.imgdata.params.use_camera_wb = 1; // Configured before open_file for matrix selection.
    int ret = open_camera_raw(raw, file_path, backing, true);
    if (ret != LIBRAW_SUCCESS) {
        out_image->error_code = ret;
        return ret;
    }

    // unpack() recycles unsupported decoder state. Identify Nikon's HE stub
    // while the identified decoder is still available; ordinary NEF is unaffected.
    libraw_decoder_info_t decoder = {};
    if (raw.get_decoder_info(&decoder) == LIBRAW_SUCCESS && decoder.decoder_name
        && strstr(decoder.decoder_name, "nikon_he_load_raw")) {
        out_image->error_code = LUMISEQ_NIKON_HE_UNSUPPORTED;
        return LUMISEQ_NIKON_HE_UNSUPPORTED;
    }

    // dcraw_process converts floating sensor DNG to integers. Reject that path
    // explicitly until a float sensor demosaic is implemented.
    if (calibration && raw.is_floating_point()) {
        out_image->error_code=LUMISEQ_FLOAT_RAW_UNSUPPORTED;
        return LUMISEQ_FLOAT_RAW_UNSUPPORTED;
    }
    ret = raw.unpack();
    if (ret != LIBRAW_SUCCESS) {
        out_image->error_code = ret;
        raw.recycle();
        return ret;
    }

    // Configure high quality 16-bit linear output
    raw.imgdata.params.output_bps = 16;
    raw.imgdata.params.output_color = calibration ? 0 : 1;
    raw.imgdata.params.no_auto_scale = calibration ? 1 : 0;
    if (calibration) raw.imgdata.params.adjust_maximum_thr = 0.f;
    raw.imgdata.params.gamm[0] = 1.0;    // Linear
    raw.imgdata.params.gamm[1] = 1.0;
    // Keep LibRaw's histogram-driven output gain out of editor exposure=0.
    // LibRaw's histogram-driven output brightening otherwise occurs even with
    // linear gamma and silently changes the meaning of exposure=0.
    raw.imgdata.params.no_auto_bright = 1;
    // The processed 16-bit sRGB result can still clip during camera conversion;
    // this flag does not retain sensor-space highlights or out-of-gamut values.
    raw.imgdata.params.bright = 1.0;
    raw.imgdata.params.user_qual = demosaic_quality; // 0=linear, 1=VNG, 2=PPG, 3=AHD, 11=DHT, 12=AAHD

    ret = raw.dcraw_process();
    if (ret != LIBRAW_SUCCESS) {
        out_image->error_code = ret;
        raw.recycle();
        return ret;
    }

    libraw_processed_image_t* image = raw.dcraw_make_mem_image(&ret);
    if (!image || ret != LIBRAW_SUCCESS) {
        out_image->error_code = ret;
        raw.recycle();
        return ret;
    }

    if (calibration) {
        active_crop(raw,calibration->optics);
        auto& crop=calibration->optics.crop;
        const auto& sizes=raw.imgdata.sizes;
        if (crop[2] && crop[3]) {
            // Match the orientation already applied by dcraw_make_mem_image.
            if (sizes.flip & 2) crop[1]=sizes.height-crop[1]-crop[3];
            if (sizes.flip & 1) crop[0]=sizes.width-crop[0]-crop[2];
            if (sizes.flip & 4) {std::swap(crop[0],crop[1]); std::swap(crop[2],crop[3]);}
        }
        if (strncmp(raw.imgdata.idata.make,"Sony",4)) {
            memset(calibration->optics.distortion,0,sizeof(calibration->optics.distortion));
            memset(calibration->optics.aberration,0,sizeof(calibration->optics.aberration));
            memset(calibration->optics.shading,0,sizeof(calibration->optics.shading));
        }
    }

    out_image->width = image->width;
    out_image->height = image->height;
    out_image->channels = image->colors;
    out_image->bits_per_channel = image->bits;
    out_image->data_size = image->data_size;
    out_image->data = (uint8_t*)malloc(image->data_size);
    if (out_image->data) {
        memcpy(out_image->data, image->data, image->data_size);
    }

    raw.dcraw_clear_mem(image);
    raw.recycle();
    if (!out_image->data) {
        out_image->error_code=LIBRAW_UNSUFFICIENT_MEMORY;
        return LIBRAW_UNSUFFICIENT_MEMORY;
    }
    return LIBRAW_SUCCESS;
}

int libraw_wrapper_decode_16bit(const char* file_path, int demosaic_quality, LibRawDecodedImage* out_image) {
    return decode_processed(file_path, demosaic_quality, out_image, nullptr);
}

int libraw_wrapper_decode_scene(const char* file_path, int demosaic_quality, LibRawDecodedImage* out_image, LibRawSceneCalibration* calibration) {
    if (!calibration) return LIBRAW_DATA_ERROR;
    return decode_processed(file_path, demosaic_quality, out_image, calibration);
}

void libraw_wrapper_free_image(LibRawDecodedImage* image) {
    if (image && image->data) {
        free(image->data);
        image->data = NULL;
        image->data_size = 0;
    }
}

}
