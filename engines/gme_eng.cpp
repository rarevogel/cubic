// Game Music Emu engine: AY, GBS, GYM, HES, KSS, NSF/NSFE, SAP, SPC, VGM (VGZ is unpacked in JavaScript).
#include "common.h"
#include "gme.h"

static Music_Emu *g_emu = 0;
static int g_rate = 48000, g_track = 0, g_count = 0;
static gme_info_t *g_inf = 0;
static int g_mute = 0;

EXPORT uint8_t *eng_alloc(int n) { return (uint8_t *)malloc(n); }
EXPORT void eng_free(void *p) { free(p); }
EXPORT void eng_addfile(const char *, const uint8_t *, int) {}
static void unload() { if (g_inf) { gme_free_info(g_inf); g_inf = 0; } if (g_emu) { gme_delete(g_emu); g_emu = 0; } }
static void start(int t) {
  if (g_inf) { gme_free_info(g_inf); g_inf = 0; }
  g_track = t; gme_track_info(g_emu, &g_inf, t);
  gme_start_track(g_emu, t);
  long len = g_inf ? g_inf->length : -1;
  if (len <= 0 && g_inf) { len = g_inf->intro_length + g_inf->loop_length * 2; if (len <= 0) len = 150000; }
  gme_set_fade(g_emu, (int)len);
  gme_mute_voices(g_emu, g_mute);
}
EXPORT int eng_load(const uint8_t *data, int len, const char *name, int rate) {
  unload(); g_rate = rate; g_mute = 0;
  if (gme_open_data(data, len, &g_emu, rate)) { g_emu = 0; return 0; }
  gme_enable_accuracy(g_emu, 1);
  g_count = gme_track_count(g_emu);
  start(0);
  return 1;
}
EXPORT int eng_render(int16_t *out, int frames) {
  if (!g_emu) return 0;
  if (gme_play(g_emu, frames * 2, out)) return 0;
  return frames;
}
EXPORT int eng_ended() { return g_emu ? gme_track_ended(g_emu) : 1; }
EXPORT double eng_pos_ms() { return g_emu ? gme_tell(g_emu) : 0; }
EXPORT int eng_select(int t) { if (!g_emu || t < 0 || t >= g_count) return 0; start(t); return 1; }
EXPORT void eng_seek(double ms) { if (g_emu) gme_seek(g_emu, (int)ms); }
EXPORT int eng_channels(uint8_t *lv, uint16_t *freq, int max) { (void)lv; (void)freq; (void)max; return 0; }
EXPORT void eng_mute(int ch, int on) { if (!g_emu) return; if (on) g_mute |= 1 << ch; else g_mute &= ~(1 << ch); gme_mute_voices(g_emu, g_mute); }
EXPORT const char *eng_info() {
  js_begin(); js_raw("{");
  if (g_emu && g_inf) {
    js_str("engine", "Game Music Emu"); js_str("type", g_inf->system); js_str("title", g_inf->song); js_str("game", g_inf->game);
    js_str("author", g_inf->author); js_str("copyright", g_inf->copyright); js_str("desc", g_inf->comment); js_str("dumper", g_inf->dumper);
    js_num("songs", g_count); js_num("lengthMs", g_inf->length > 0 ? g_inf->length : (g_inf->intro_length + g_inf->loop_length * 2 > 0 ? g_inf->intro_length + g_inf->loop_length * 2 : 150000));
    int nv = gme_voice_count(g_emu); js_num("channels", nv);
    js_raw("\"voices\":[");
    for (int i = 0; i < nv; i++) { js_raw("\""); js_raw(gme_voice_name(g_emu, i)); js_raw(i < nv - 1 ? "\"," : "\""); }
    js_raw("],");
  }
  js_end(); js_raw("}"); return g_json;
}
EXPORT const char *eng_status() { js_begin(); js_raw("{"); js_num("track", g_track); js_end(); js_raw("}"); return g_json; }
