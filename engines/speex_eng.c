// Speex decoder for Ogg Speex (.spx): the JS side demuxes Ogg, this decodes packets.
#include <stdlib.h>
#include <string.h>
#include <speex/speex.h>
#include <speex/speex_header.h>
#include <speex/speex_stereo.h>
#include <speex/speex_callbacks.h>
#define EXP __attribute__((visibility("default")))
static void *st; static SpeexBits bits; static SpeexStereoState *stereo; static int frame_size, nframes, channels, rate;
static SpeexCallback cb;
EXP void *spx_alloc(int n) { return malloc(n); }
EXP void spx_free(void *p) { free(p); }
// returns sample rate, or 0 on failure; out: [frame_size, frames_per_packet, channels]
EXP int spx_open(const char *hdr, int len, int *out) {
  SpeexHeader *h = speex_packet_to_header((char *)hdr, len);
  if (!h || h->mode < 0 || h->mode >= SPEEX_NB_MODES) return 0;
  const SpeexMode *m = speex_lib_get_mode(h->mode);
  st = speex_decoder_init(m);
  if (!st) return 0;
  int enh = 1; speex_decoder_ctl(st, SPEEX_SET_ENH, &enh);
  speex_decoder_ctl(st, SPEEX_GET_FRAME_SIZE, &frame_size);
  rate = h->rate; speex_decoder_ctl(st, SPEEX_SET_SAMPLING_RATE, &rate);
  nframes = h->frames_per_packet > 0 ? h->frames_per_packet : 1;
  channels = h->nb_channels == 2 ? 2 : 1;
  if (channels == 2) {
    stereo = speex_stereo_state_init();
    cb.callback_id = SPEEX_INBAND_STEREO; cb.func = speex_std_stereo_request_handler; cb.data = stereo;
    speex_decoder_ctl(st, SPEEX_SET_HANDLER, &cb);
  }
  speex_bits_init(&bits);
  out[0] = frame_size; out[1] = nframes; out[2] = channels;
  speex_header_free(h);
  return rate;
}
// decode one packet into out (float, interleaved if stereo); returns samples per channel
EXP int spx_decode(const char *pkt, int len, float *out) {
  speex_bits_read_from(&bits, (char *)pkt, len);
  int total = 0;
  for (int i = 0; i < nframes; i++) {
    float *o = out + total * channels;
    int r = speex_decode(st, &bits, o);
    if (r == -1) break; if (r == -2) return -1;
    if (speex_bits_remaining(&bits) < 0) break;
    if (channels == 2) speex_decode_stereo(o, frame_size, stereo);
    total += frame_size;
  }
  for (int i = 0; i < total * channels; i++) out[i] *= (1.0f / 32768.0f);
  return total;
}
