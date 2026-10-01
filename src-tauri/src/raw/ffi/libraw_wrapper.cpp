// src-tauri/src/raw/ffi/libraw_wrapper.cpp
#include "libraw_wrapper.h"
#include <libraw/libraw.h>
#include <cstring>
#include <cstdlib>
#include <cmath>

extern "C" {

int libraw_wrapper_get_metadata(const char* file_path, LibRawMetaResult* out_meta) {
    if (!file_path || !out_meta) return -1;
    memset(out_meta, 0, sizeof(LibRawMetaResult));

    LibRaw raw;
    // LibRaw derives use_camera_matrix from use_camera_wb while opening the
    // file, so this must be configured before open_file(), not before only
    // dcraw_process().
    raw.imgdata.params.use_camera_wb = 1;
    int ret = raw.open_file(file_path);
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
        out_meta->black_levels[i] = raw.imgdata.color.cblack[i];
    }
    out_meta->white_level = raw.imgdata.color.maximum;

    out_meta->has_thumb = raw.imgdata.thumbnail.tlength > 0 ? 1 : 0;
    out_meta->thumb_width = raw.imgdata.thumbnail.twidth;
    out_meta->thumb_height = raw.imgdata.thumbnail.theight;

    raw.recycle();
    return LIBRAW_SUCCESS;
}

int libraw_wrapper_extract_thumbnail(const char* file_path, LibRawThumbResult* out_thumb) {
    if (!file_path || !out_thumb) return -1;
    memset(out_thumb, 0, sizeof(LibRawThumbResult));

    LibRaw raw;
    int ret = raw.open_file(file_path);
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
    return LIBRAW_SUCCESS;
}

void libraw_wrapper_free_thumb(LibRawThumbResult* thumb) {
    if (thumb && thumb->data) {
        free(thumb->data);
        thumb->data = NULL;
        thumb->data_size = 0;
    }
}

int libraw_wrapper_decode_16bit(const char* file_path, int demosaic_quality, LibRawDecodedImage* out_image) {
    if (!file_path || !out_image) return -1;
    memset(out_image, 0, sizeof(LibRawDecodedImage));

    LibRaw raw;
    raw.imgdata.params.use_camera_wb = 1; // Configured before open_file for matrix selection.
    int ret = raw.open_file(file_path);
    if (ret != LIBRAW_SUCCESS) {
        out_image->error_code = ret;
        return ret;
    }

    ret = raw.unpack();
    if (ret != LIBRAW_SUCCESS) {
        out_image->error_code = ret;
        raw.recycle();
        return ret;
    }

    // Configure high quality 16-bit linear output
    raw.imgdata.params.output_bps = 16;
    raw.imgdata.params.output_color = 1; // 1 = sRGB
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
    return LIBRAW_SUCCESS;
}

void libraw_wrapper_free_image(LibRawDecodedImage* image) {
    if (image && image->data) {
        free(image->data);
        image->data = NULL;
        image->data_size = 0;
    }
}

}
