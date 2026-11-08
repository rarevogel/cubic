// MIDI engine: MID/RMI/KAR, XMI and MUS (Doom). Plays through libADLMIDI (OPL3 FM, like a DOS sound card)
// or, when a SoundFont (.sf2) has been added, through TinySoundFont.
#include "common.h"
#include <vector>
#include <string>
#include "adlmidi.h"
#define TSF_IMPLEMENTATION
#include "tsf.h"
#define TML_IMPLEMENTATION
#include "tml.h"

static ADL_MIDIPlayer *g_adl = 0;
static tsf *g_tsf = 0; static tml_message *g_tml = 0, *g_cur = 0;
static std::vector<uint8_t> g_sf;      // SoundFont bytes, if any
static int g_rate = 48000, g_bank = 58, g_ended = 0;
static double g_posms = 0, g_lenms = 0;
static uint8_t g_lv[16]; static uint16_t g_fr[16]; static uint32_t g_mute = 0;
static std::string g_title;

EXPORT uint8_t *eng_alloc(int n) { return (uint8_t *)malloc(n); }
EXPORT void eng_free(void *p) { free(p); }
EXPORT void eng_addfile(const char *name, const uint8_t *data, int len) {
  std::string n = name; for (auto &c : n) c = (char)tolower((unsigned char)c);
  if (n.size() > 4 && n.substr(n.size() - 4) == ".sf2") g_sf.assign(data, data + len);
}
EXPORT void eng_clearfiles() { g_sf.clear(); }
EXPORT void eng_setbank(int b) { g_bank = b; }
static void note_hook(void *, int adlchn, int note, int ins, int pressure, double) {
  (void)adlchn; int ch = ins & 15;  // libADLMIDI passes the MIDI channel in 'ins'
  if (pressure > 0) { g_lv[ch] = (uint8_t)(pressure * 2 > 255 ? 255 : pressure * 2); g_fr[ch] = (uint16_t)(440.0 * pow(2.0, (note - 69) / 12.0)); }
}
static void unload() {
  if (g_adl) { adl_close(g_adl); g_adl = 0; }
  if (g_tml) { tml_free(g_tml); g_tml = 0; } g_cur = 0;
  if (g_tsf) { tsf_close(g_tsf); g_tsf = 0; }
}
EXPORT int eng_load(const uint8_t *data, int len, const char *name, int rate) {
  (void)name; unload(); g_rate = rate; g_ended = 0; g_posms = 0; memset(g_lv, 0, sizeof g_lv); memset(g_fr, 0, sizeof g_fr);
  if (!g_sf.empty()) {
    g_tml = tml_load_memory(data, len);
    if (g_tml) {
      g_tsf = tsf_load_memory(g_sf.data(), (int)g_sf.size());
      if (g_tsf) {
        tsf_set_output(g_tsf, TSF_STEREO_INTERLEAVED, rate, 0.0f);
        tsf_channel_set_bank_preset(g_tsf, 9, 128, 0);
        g_cur = g_tml; unsigned int dur = 0; tml_get_info(g_tml, 0, 0, 0, 0, &dur); g_lenms = dur;
        return 1;
      }
      tml_free(g_tml); g_tml = 0;
    }
  }
  g_adl = adl_init(rate);
  if (!g_adl) return 0;
  adl_switchEmulator(g_adl, ADLMIDI_EMU_NUKED);
  adl_setNumChips(g_adl, 2);
  adl_setBank(g_adl, g_bank);
  adl_setSoftPanEnabled(g_adl, 1);
  adl_setLoopEnabled(g_adl, 0);
  adl_setNoteHook(g_adl, note_hook, 0);
  if (adl_openData(g_adl, data, len) < 0) { unload(); return 0; }
  g_lenms = adl_totalTimeLength(g_adl) * 1000.0;
  const char *t = adl_metaMusicTitle(g_adl); g_title = t ? t : "";
  for (int c = 0; c < 16; c++) adl_setChannelEnabled(g_adl, c, !((g_mute >> c) & 1));
  return 1;
}
EXPORT int eng_render(int16_t *out, int frames) {
  { double k = pow(0.9, frames / 1024.0); for (int i = 0; i < 16; i++) g_lv[i] = (uint8_t)(g_lv[i] * k); }
  if (g_adl) {
    int got = adl_play(g_adl, frames * 2, out);
    if (got < frames * 2) { memset(out + got, 0, (frames * 2 - got) * 2); }
    if (adl_atEnd(g_adl)) g_ended = 1;
    g_posms = adl_positionTell(g_adl) * 1000.0;
    return frames;
  }
  if (g_tsf) {
    int done = 0, block = 64;
    while (done < frames) {
      int n = frames - done < block ? frames - done : block;
      double until = g_posms + n * 1000.0 / g_rate;
      for (; g_cur && g_cur->time <= until; g_cur = g_cur->next) {
        int ch = g_cur->channel & 15;
        switch (g_cur->type) {
          case TML_PROGRAM_CHANGE: tsf_channel_set_presetnumber(g_tsf, ch, g_cur->program, ch == 9); break;
          case TML_NOTE_ON: if (!((g_mute >> ch) & 1)) { tsf_channel_note_on(g_tsf, ch, g_cur->key, g_cur->velocity / 127.0f); g_lv[ch] = (uint8_t)(g_cur->velocity * 2); g_fr[ch] = (uint16_t)(440.0 * pow(2.0, (g_cur->key - 69) / 12.0)); } break;
          case TML_NOTE_OFF: tsf_channel_note_off(g_tsf, ch, g_cur->key); break;
          case TML_PITCH_BEND: tsf_channel_set_pitchwheel(g_tsf, ch, g_cur->pitch_bend); break;
          case TML_CONTROL_CHANGE: tsf_channel_midi_control(g_tsf, ch, g_cur->control, g_cur->control_value); break;
        }
      }
      tsf_render_short(g_tsf, out + done * 2, n, 0);
      done += n; g_posms = until;
    }
    if (!g_cur && g_posms > g_lenms + 3000) g_ended = 1;
    return frames;
  }
  return 0;
}
EXPORT int eng_ended() { return g_ended; }
EXPORT double eng_pos_ms() { return g_posms; }
EXPORT int eng_select(int) { return 0; }
EXPORT void eng_seek(double ms) {
  if (g_adl) { adl_positionSeek(g_adl, ms / 1000.0); g_posms = ms; }
  if (g_tsf) { tsf_reset(g_tsf); g_cur = g_tml; g_posms = 0; for (; g_cur && g_cur->time < ms; g_cur = g_cur->next) { if (g_cur->type == TML_PROGRAM_CHANGE) tsf_channel_set_presetnumber(g_tsf, g_cur->channel, g_cur->program, g_cur->channel == 9); else if (g_cur->type == TML_CONTROL_CHANGE) tsf_channel_midi_control(g_tsf, g_cur->channel, g_cur->control, g_cur->control_value); } g_posms = ms; }
}
EXPORT int eng_channels(uint8_t *lv, uint16_t *freq, int max) { int n = max < 16 ? max : 16; memcpy(lv, g_lv, n); memcpy(freq, g_fr, n * 2); return n; }
EXPORT void eng_mute(int ch, int on) { if (on) g_mute |= 1u << ch; else g_mute &= ~(1u << ch); if (g_adl) adl_setChannelEnabled(g_adl, ch, !on); if (g_tsf && on) tsf_channel_note_off_all(g_tsf, ch); }
EXPORT const char *eng_info() {
  js_begin(); js_raw("{");
  if (g_adl || g_tsf) {
    js_str("engine", g_tsf ? "TinySoundFont" : "libADLMIDI (OPL3)");
    js_str("type", g_tsf ? "MIDI (SoundFont)" : "MIDI (OPL3 FM)"); js_str("title", g_title.c_str());
    if (g_adl) js_str("bank", adl_getBankNames()[g_bank]);
    js_num("songs", 1); js_num("channels", 16); js_num("lengthMs", g_lenms);
  }
  js_end(); js_raw("}"); return g_json;
}
EXPORT const char *eng_banks() {
  js_begin(); js_raw("[");
  const char *const *n = adl_getBankNames(); int c = adl_getBanksCount();
  for (int i = 0; i < c; i++) { js_raw("\""); for (const char *p = n[i]; *p; p++) { char t[3] = {0}; if (*p == '"' || *p == '\\') { t[0] = '\\'; t[1] = *p; } else t[0] = *p; js_raw(t); } js_raw(i < c - 1 ? "\"," : "\""); }
  js_raw("]"); return g_json;
}
EXPORT const char *eng_status() { js_begin(); js_raw("{}"); return g_json; }
