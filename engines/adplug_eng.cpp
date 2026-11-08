// AdPlug engine: all AdPlug OPL2/OPL3 formats, rendered with the Nuked OPL3 emulator.
#include "common.h"
#include <string>
#include <map>
#include <vector>
#include "adplug.h"
#include "nemuopl.h"
#include "binstr.h"

struct MemFile { std::vector<uint8_t> data; };
static std::map<std::string, MemFile> g_files;   // lower-case name -> data (main file + companions such as .bnk/.ins)
static std::string lower(std::string s) { for (auto &c : s) c = (char)tolower((unsigned char)c); return s; }
static std::string basename_(const std::string &p) { size_t i = p.find_last_of("/\\"); return lower(i == std::string::npos ? p : p.substr(i + 1)); }

class MemProvider : public CFileProvider {
public:
  binistream *open(std::string filename) const override {
    auto it = g_files.find(basename_(filename));
    if (it == g_files.end()) return 0;
    binisstream *f = new binisstream((void *)it->second.data.data(), it->second.data.size());
    if (f->error()) { delete f; return 0; }
    f->setFlag(binio::BigEndian, false); f->setFlag(binio::FloatIEEE);
    return f;
  }
  void close(binistream *f) const override { delete f; }
};

// OPL wrapper that watches register writes to show channel activity
class TapOpl : public Copl {
public:
  CNemuopl emu; int lvl[18]; int on[18]; int fnum[18]; int tl[18];
  TapOpl(int rate) : emu(rate) { currType = TYPE_OPL3; memset(lvl, 0, sizeof lvl); memset(on, 0, sizeof on); memset(fnum, 0, sizeof fnum); memset(tl, 0, sizeof tl); }
  void update(short *buf, int samples) override { emu.update(buf, samples); }
  void init() override { emu.init(); }
  void write(int reg, int val) override {
    emu.setchip(currChip); emu.write(reg, val);
    int base = currChip ? 9 : 0;
    if (reg >= 0xB0 && reg <= 0xB8) { int ch = base + reg - 0xB0; int k = (val >> 5) & 1; fnum[ch] = (fnum[ch] & 0xFF) | ((val & 0x1F) << 8); if (k && !on[ch]) lvl[ch] = 255 - tl[ch] * 4; on[ch] = k; }
    if (reg >= 0xA0 && reg <= 0xA8) { int ch = base + reg - 0xA0; fnum[ch] = (fnum[ch] & 0x1F00) | val; }
    if (reg >= 0x40 && reg <= 0x55) { static const int opch[22] = {0,1,2,0,1,2,-1,-1,3,4,5,3,4,5,-1,-1,6,7,8,6,7,8}; int o = reg - 0x40; if (o < 22 && opch[o] >= 0 && (o % 8) >= 3) tl[base + opch[o]] = val & 63; }
  }
};

static TapOpl *g_opl = 0;
static CPlayer *g_player = 0;
static int g_rate = 48000, g_left = 0, g_song = 0, g_ended = 0;
static double g_posms = 0, g_lenms = 0;
static std::string g_name;
static uint8_t *g_buf = 0;

EXPORT uint8_t *eng_alloc(int n) { return (uint8_t *)malloc(n); }
EXPORT void eng_free(void *p) { free(p); }
EXPORT void eng_addfile(const char *name, const uint8_t *data, int len) { MemFile m; m.data.assign(data, data + len); g_files[basename_(name)] = m; }
EXPORT void eng_clearfiles() { g_files.clear(); }
static void unload() { delete g_player; g_player = 0; delete g_opl; g_opl = 0; }
EXPORT int eng_load(const uint8_t *data, int len, const char *name, int rate) {
  unload(); g_rate = rate; g_name = basename_(name);
  eng_addfile(name, data, len);
  g_opl = new TapOpl(rate); g_opl->init();
  MemProvider fp;
  g_player = CAdPlug::factory(g_name, g_opl, CAdPlug::players, fp);
  if (!g_player) { unload(); return 0; }
  g_song = 0; g_left = 0; g_ended = 0; g_posms = 0;
  g_lenms = (double)g_player->songlength(0);
  g_opl->init(); g_player->rewind(0);
  return 1;
}
EXPORT int eng_render(int16_t *out, int frames) {
  if (!g_player) return 0;
  int done = 0;
  while (done < frames) {
    if (g_left <= 0) {
      if (!g_player->update()) g_ended = 1;
      float r = g_player->getrefresh(); if (r <= 0.1f) r = 70;
      g_left = (int)(g_rate / r + 0.5f); if (g_left < 1) g_left = 1;
    }
    int n = frames - done; if (n > g_left) n = g_left;
    g_opl->update(out + done * 2, n);
    done += n; g_left -= n; g_posms += n * 1000.0 / g_rate;
  }
  for (int i = 0; i < 18; i++) { if (!g_opl->on[i]) g_opl->lvl[i] = g_opl->lvl[i] * 7 / 8; }
  return done;
}
EXPORT int eng_ended() { return g_ended; }
EXPORT double eng_pos_ms() { return g_posms; }
EXPORT int eng_select(int song) { if (!g_player) return 0; g_song = song; g_lenms = (double)g_player->songlength(song); g_opl->init(); g_player->rewind(song); g_left = 0; g_ended = 0; g_posms = 0; return 1; }
EXPORT void eng_seek(double ms) { if (!g_player) return; g_opl->init(); g_player->rewind(g_song); g_left = 0; g_posms = 0; g_ended = 0; while (g_posms < ms) { if (!g_player->update()) break; g_posms += 1000.0 / g_player->getrefresh(); } }
EXPORT int eng_channels(uint8_t *lv, uint16_t *freq, int max) {
  if (!g_opl) return 0;
  int n = max < 18 ? max : 18;
  for (int i = 0; i < n; i++) { lv[i] = (uint8_t)(g_opl->on[i] ? (g_opl->lvl[i] < 40 ? 40 : g_opl->lvl[i]) : g_opl->lvl[i]); int f = g_opl->fnum[i]; int blk = (f >> 10) & 7; int fn = f & 1023; freq[i] = g_opl->on[i] ? (uint16_t)(fn * 49716.0 / (1 << (20 - blk))) : 0; }
  return n;
}
EXPORT void eng_mute(int ch, int on) { (void)ch; (void)on; }
EXPORT const char *eng_info() {
  js_begin(); js_raw("{");
  if (g_player) {
    js_str("engine", "AdPlug"); js_str("type", g_player->gettype().c_str()); js_str("title", g_player->gettitle().c_str());
    js_str("author", g_player->getauthor().c_str()); js_str("desc", g_player->getdesc().c_str());
    js_num("songs", g_player->getsubsongs()); js_num("channels", 18);
    js_num("lengthMs", g_lenms);
    js_num("patterns", g_player->getpatterns()); js_num("orders", g_player->getorders());
    js_raw("\"instruments\":[");
    unsigned ni = g_player->getinstruments();
    for (unsigned i = 0; i < ni && i < 128; i++) { std::string s = g_player->getinstrument(i); js_raw("\""); for (char c : s) { if (c == '"' || c == '\\') js_raw("\\"); char t[2] = {(c >= 32 ? c : ' '), 0}; js_raw(t); } js_raw("\","); }
    if (g_json[g_jl - 1] == ',') g_json[--g_jl] = 0;
    js_raw("],");
  }
  js_end(); js_raw("}"); return g_json;
}
EXPORT const char *eng_status() {
  js_begin(); js_raw("{");
  if (g_player) { js_num("order", g_player->getorder()); js_num("pattern", g_player->getpattern()); js_num("row", g_player->getrow()); js_num("speed", g_player->getspeed()); }
  js_end(); js_raw("}"); return g_json;
}
