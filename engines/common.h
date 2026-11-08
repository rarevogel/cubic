// Shared C ABI for the Cubic engines compiled to WebAssembly (wasm32-wasi, reactor).
#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#ifdef __cplusplus
#define EXPORT extern "C" __attribute__((visibility("default")))
#else
#define EXPORT __attribute__((visibility("default")))
#endif
// tiny JSON string builder
static char g_json[16384];
static int g_jl;
static void js_begin(void) { g_jl = 0; g_json[0] = 0; }
static void js_raw(const char *s) { int n = (int)strlen(s); if (g_jl + n < (int)sizeof(g_json) - 1) { memcpy(g_json + g_jl, s, n); g_jl += n; g_json[g_jl] = 0; } }
static void js_str(const char *k, const char *v) {
  char tmp[8];
  js_raw("\""); js_raw(k); js_raw("\":\"");
  for (const unsigned char *p = (const unsigned char *)(v ? v : ""); *p; p++) {
    if (*p == '"' || *p == '\\') { tmp[0] = '\\'; tmp[1] = *p; tmp[2] = 0; js_raw(tmp); }
    else if (*p < 32) { snprintf(tmp, sizeof tmp, "\\u%04x", *p); js_raw(tmp); }
    else { tmp[0] = *p; tmp[1] = 0; js_raw(tmp); }
  }
  js_raw("\",");
}
static void js_num(const char *k, double v) { char b[64]; snprintf(b, sizeof b, "\"%s\":%.6g,", k, v); js_raw(b); }
static const char *js_end(void) { if (g_jl && g_json[g_jl - 1] == ',') g_json[--g_jl] = 0; return g_json; }
