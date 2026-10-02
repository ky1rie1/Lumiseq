// src-tauri/src/raw/ffi/libraw_wrapper.h
#ifndef LIBRAW_WRAPPER_H
#define LIBRAW_WRAPPER_H

#include <stddef.h>
#include <stdint.h>

// Wrapper-specific unsupported Nikon HE codec; never confused with corrupt data.
#define LUMISEQ_NIKON_HE_UNSUPPORTED (-200001)
#define LUMISEQ_FLOAT_RAW_UNSUPPORTED (-200002)

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint32_t crop[4];
    int16_t distortion[17];
    int16_t aberration[33];
    int16_t shading[17];
} LibRawOptics;

typedef struct {
    char make[64];
    char model[64];
    uint32_t width;
    uint32_t height;
    uint32_t raw_width;
    uint32_t raw_height;
    uint32_t flip;
    uint32_t colors;
    uint32_t bits_per_sample;
    float cam_mul[4];
    float pre_mul[4];
    float cmatrix[3][4];
    float rgb_cam[3][4];
    uint32_t black_levels[4];
    uint32_t white_level;
    int has_thumb;
    uint32_t thumb_width;
    uint32_t thumb_height;
    int error_code;
    LibRawOptics optics;
} LibRawMetaResult;

typedef struct {
    uint32_t width;
    uint32_t height;
    uint32_t channels;
    uint32_t bits_per_channel;
    size_t data_size;
    uint8_t* data;
    int error_code;
} LibRawDecodedImage;

typedef struct {
    float normalization;
    float multipliers[4];
    float matrix[3][4];
    LibRawOptics optics;
} LibRawSceneCalibration;

typedef struct {
    size_t data_size;
    uint8_t* data;
    int is_jpeg;
    int error_code;
} LibRawThumbResult;

int libraw_wrapper_get_metadata(const char* file_path, LibRawMetaResult* out_meta);
int libraw_wrapper_extract_thumbnail(const char* file_path, LibRawThumbResult* out_thumb);
void libraw_wrapper_free_thumb(LibRawThumbResult* thumb);

int libraw_wrapper_decode_16bit(const char* file_path, int demosaic_quality, LibRawDecodedImage* out_image);
int libraw_wrapper_decode_scene(const char* file_path, int demosaic_quality, LibRawDecodedImage* out_image, LibRawSceneCalibration* calibration);
void libraw_wrapper_free_image(LibRawDecodedImage* image);

#ifdef __cplusplus
}
#endif

#endif // LIBRAW_WRAPPER_H
