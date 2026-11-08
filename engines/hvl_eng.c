// HivelyTracker / AHX engine (the original replayer from HivelyTracker).
#include "common.h"
#include "hvl_replay.h"

static struct hvl_tune *g_ht = 0;
static int g_rate = 48000, g_left = 0, g_flen = 0, g_bufpos = 0, g_ended = 0, g_song = 0;
static int16_t g_frame[48000 / 50 * 2 * 4 + 64];
static double g_posms = 0;
static uint32_t g_mute = 0;

EXPORT uint8_t *eng_alloc(int n) { return (uint8_t *)malloc(n); }
EXPORT void eng_free(void *p) { free(p); }
EXPORT void eng_addfile(const char *a, const uint8_t *b, int c) { (void)a; (void)b; (void)c; }
static int inited = 0;
EXPORT int eng_load(const uint8_t *data, int len, const char *name, int rate) {
  (void)name;
  if (!inited) { hvl_InitReplayer(); inited = 1; }
  if (g_ht) { hvl_FreeTune(g_ht); g_ht = 0; }
  g_rate = rate;
  g_ht = hvl_ParseTune(data, len, rate, 2);
  if (!g_ht) return 0;
  hvl_InitSubsong(g_ht, 0); g_song = 0;
  g_left = 0; g_ended = 0; g_posms = 0; g_mute = 0;
  return 1;
}
EXPORT int eng_render(int16_t *out, int frames) {
  if (!g_ht) return 0;
  int done = 0;
  while (done < frames) {
    if (g_left <= 0) {
      g_flen = g_rate / 50 / (g_ht->ht_SpeedMultiplier ? g_ht->ht_SpeedMultiplier : 1);
      for (int c = 0; c < g_ht->ht_Channels; c++) g_ht->ht_Voices[c].vc_TrackOn = (g_mute >> c) & 1 ? 0 : 1;
      hvl_DecodeFrame(g_ht, (int8 *)g_frame, (int8 *)g_frame + 2, 4);
      if (g_ht->ht_SongEndReached) g_ended = 1;
      g_left = g_flen; g_bufpos = 0;
    }
    int n = frames - done; if (n > g_left) n = g_left;
    memcpy(out + done * 2, g_frame + g_bufpos * 2, n * 4);
    done += n; g_left -= n; g_bufpos += n; g_posms += n * 1000.0 / g_rate;
  }
  return done;
}
EXPORT int eng_ended() { return g_ended; }
EXPORT double eng_pos_ms() { return g_posms; }
EXPORT int eng_select(int s) { if (!g_ht || s < 0 || s > g_ht->ht_SubsongNr) return 0; hvl_InitSubsong(g_ht, s); g_song = s; g_left = 0; g_ended = 0; g_posms = 0; return 1; }
EXPORT void eng_seek(double ms) { (void)ms; }
EXPORT int eng_channels(uint8_t *lv, uint16_t *freq, int max) {
  if (!g_ht) return 0;
  int n = g_ht->ht_Channels < max ? g_ht->ht_Channels : max;
  for (int i = 0; i < n; i++) {
    struct hvl_voice *v = &g_ht->ht_Voices[i];
    int a = v->vc_VoiceVolume * 4; lv[i] = (uint8_t)(a > 255 ? 255 : a);
    freq[i] = (v->vc_VoiceVolume && v->vc_VoicePeriod) ? (uint16_t)(3546897.0 / v->vc_VoicePeriod / 4) : 0;
  }
  return n;
}
EXPORT void eng_mute(int ch, int on) { if (on) g_mute |= 1u << ch; else g_mute &= ~(1u << ch); }
static const char *NOTES[12] = {"C-","C#","D-","D#","E-","F-","F#","G-","G#","A-","A#","B-"};
// one cell of the track view: note, instrument, two effects
EXPORT const char *eng_cell(int pos, int row, int ch) {
  static char b[32];
  if (!g_ht || pos < 0 || pos >= g_ht->ht_PositionNr || row < 0 || row >= g_ht->ht_TrackLength || ch >= g_ht->ht_Channels) { b[0] = 0; return b; }
  struct hvl_position *p = &g_ht->ht_Positions[pos];
  struct hvl_step *s = &g_ht->ht_Tracks[p->pos_Track[ch]][row];
  char nt[4] = "---";
  if (s->stp_Note) { int n = s->stp_Note - 1 + p->pos_Transpose[ch]; if (n < 0) n = 0; snprintf(nt, sizeof nt, "%s%d", NOTES[n % 12], n / 12 + 1); }
  char in[3] = ".."; if (s->stp_Instrument) snprintf(in, sizeof in, "%02d", s->stp_Instrument);
  snprintf(b, sizeof b, "%s %s %X%02X %X%02X", nt, in, s->stp_FX, s->stp_FXParam, s->stp_FXb, s->stp_FXbParam);
  return b;
}
EXPORT const char *eng_info() {
  js_begin(); js_raw("{");
  if (g_ht) {
    js_str("engine", "HivelyTracker"); js_str("type", g_ht->ht_Version == 0 && g_ht->ht_Channels == 4 ? "AHX / HivelyTracker" : "HivelyTracker");
    js_str("title", g_ht->ht_Name); js_num("songs", g_ht->ht_SubsongNr + 1); js_num("channels", g_ht->ht_Channels);
    js_num("orders", g_ht->ht_PositionNr); js_num("rows", g_ht->ht_TrackLength); js_num("lengthMs", 0);
    js_raw("\"instruments\":[");
    for (int i = 1; i <= g_ht->ht_InstrumentNr; i++) { js_raw("\""); const char *s = g_ht->ht_Instruments[i].ins_Name; for (; *s; s++) { char t[3] = {0}; if (*s == '"' || *s == '\\') { t[0] = '\\'; t[1] = *s; } else t[0] = (*s >= 32 ? *s : ' '); js_raw(t); } js_raw(i < g_ht->ht_InstrumentNr ? "\"," : "\""); }
    js_raw("],");
  }
  js_end(); js_raw("}"); return g_json;
}
EXPORT const char *eng_status() {
  js_begin(); js_raw("{");
  if (g_ht) { js_num("order", g_ht->ht_PosNr); js_num("row", g_ht->ht_NoteNr); js_num("speed", g_ht->ht_Tempo); }
  js_end(); js_raw("}"); return g_json;
}
