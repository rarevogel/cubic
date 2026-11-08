// Which engine plays which file. Every engine is tried in order until one accepts the file.

// libopenmpt reports its own list at runtime; this is the list of libopenmpt 0.8 as a fallback.
export let MPT_EXTS = new Set('mptm mod s3m xm it 667 669 amf ams c67 cba dbm digi dmf dsm dsym dtm etx far fc fc13 fc14 fmt fst ftm imf ims ice j2b m15 mdl med mms mt2 mtm mus nst okt plm psm pt36 ptm puma rtm sfx sfx2 smod st26 stk stm stx stp symmod tcb gmc gtk gt2 ult unic wow xmf gdm mo3 oxm umx xpk ppm mmcmp mdz s3z xmz itz mdr'.split(' '));
export function setMptExts(list) { for (const e of list) if (e) MPT_EXTS.add(e.toLowerCase()); }

export const ADPLUG_EXTS = new Set('hsc sng imf wlf adlib a2m a2t amd xms bam cmf adl d00 dfm hsp ksm mad mus mdy ims mdi sci laa mkj cff dmo dtm mtk mtr rad rac raw sat sa2 xad bmf lds plx m rol xsm dro pis msc rix mkf jbm got sop hsq sqx sdb agd ha2 wm fmk'.split(' '));
export const GME_EXTS = new Set('ay gbs gym hes kss nsf nsfe sap spc vgm vgz'.split(' '));
export const HVL_EXTS = new Set(['hvl', 'ahx']);
export const MIDI_EXTS = new Set('mid midi smf rmi kar xmi'.split(' '));
export const CAW_EXTS = new Set('sid psid rsid sndh snd ym vtx psg asc pt2 pt3 stc ts'.split(' '));
// PCM: [extension] -> decoder ('native' = the browser decodes it)
export const PCM_EXTS = {
  wav: 'native', wave: 'native', mp3: 'native', ogg: 'native', oga: 'native', opus: 'native', flac: 'native',
  m4a: 'aac', m4b: 'aac', mp4: 'aac', aac: 'aac', adts: 'aac', alac: 'aac', webm: 'native', weba: 'native', mka: 'native',
  mp1: 'mpg123', mp2: 'mpg123', mpa: 'mpg123', mpga: 'mpg123',
  qoa: 'qoa', wv: 'wavpack', tta: 'tta', ape: 'ape', mpc: 'mpc', mpp: 'mpc', wma: 'wma', asf: 'wma',
  aif: 'aiff', aiff: 'aiff', aifc: 'aiff', dsf: 'dsd', dff: 'dsd', caf: 'caf', ac3: 'ac3', spx: 'speex',
};
export const ARCHIVE_EXTS = new Set(['zip', 'gz', 'tgz', 'tar']);
export const LIST_EXTS = new Set(['cue', 'm3u', 'm3u8', 'pls']);
export const SOUNDFONT_EXTS = new Set(['sf2']);

export function ext(name) {
  const b = baseName(name).toLowerCase();
  const i = b.lastIndexOf('.');
  // Amiga style prefixes: mod.title, mdat.xxx
  if (i < 0) return '';
  const e = b.slice(i + 1);
  if (i > 0 && !isKnown(e)) { const pre = b.slice(0, b.indexOf('.')); if (isKnown(pre)) return pre; }
  return e;
}
export function baseName(p) { return String(p).replace(/^.*[\\/]/, ''); }
export function dirName(p) { const s = String(p); const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')); return i < 0 ? '' : s.slice(0, i); }

function isKnown(e) {
  return MPT_EXTS.has(e) || ADPLUG_EXTS.has(e) || GME_EXTS.has(e) || HVL_EXTS.has(e) || MIDI_EXTS.has(e) || CAW_EXTS.has(e) || e in PCM_EXTS;
}
export function isPlayable(name) { return isKnown(ext(name)); }

const asc = (b, o, s) => { for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false; return true; };
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// VGM: look at the chip clocks in the header to pick an engine
function vgmEngines(b) {
  const ver = u32(b, 8);
  const dataOff = ver >= 0x150 && u32(b, 0x34) ? 0x34 + u32(b, 0x34) : 0x40;
  const clk = (o) => (o + 4 <= dataOff && o + 4 <= b.length) ? (u32(b, o) & 0x3fffffff) : 0;
  const sn = clk(0x0c), opll = clk(0x10), opn2 = clk(0x2c);
  const opl2 = clk(0x50), opl = clk(0x54), msx = clk(0x58), opl3 = clk(0x5c), ay = clk(0x74);
  if (!sn && !opll && !opn2 && (opl2 || opl || opl3 || msx)) return ['adplug', 'gme'];
  if (!sn && !opll && !opn2 && ay) return ['caw', 'gme'];
  return ['gme', 'adplug', 'caw'];
}

// Returns the list of engines to try for this file, best first.
export function engines(name, b) {
  const e = ext(name);
  // magic first
  if (b.length >= 4) {
    if (asc(b, 0, 'Vgm ')) return vgmEngines(b);
    if (asc(b, 0, 'MThd') || asc(b, 0, 'RIFF') && asc(b, 8, 'RMID')) return ['midi', 'adplug'];
    if (asc(b, 0, 'FORM') && (asc(b, 8, 'XDIR') || asc(b, 8, 'XMID'))) return ['midi', 'adplug'];
    if (asc(b, 0, 'MUS\x1a')) return ['midi'];
    if (asc(b, 0, 'THX') || asc(b, 0, 'HVL')) return ['hvl'];
    if (asc(b, 1, 'SID') && (b[0] === 0x50 || b[0] === 0x52)) return ['caw'];
    if (asc(b, 0, 'NESM\x1a') || asc(b, 0, 'NSFE') || asc(b, 0, 'GBS\x01') || asc(b, 0, 'HESM') || asc(b, 0, 'KSCC') || asc(b, 0, 'KSSX') || asc(b, 0, 'GYMX')) return ['gme', 'caw'];
    if (asc(b, 0, 'SNES-SPC700')) return ['gme', 'caw'];
    if (asc(b, 0, 'SAP\r\n')) return ['gme', 'caw'];
    if (asc(b, 0, 'ZXAYEMUL')) return ['gme', 'caw'];
    if (asc(b, 0, 'DBRAWOPL')) return ['adplug', 'caw'];
    if (asc(b, 0, 'YM5!') || asc(b, 0, 'YM6!') || asc(b, 0, 'YM3!') || asc(b, 0, 'PSG\x1a')) return ['caw'];
    if (b.length > 16 && asc(b, 12, 'SNDH')) return ['caw'];
    if (b.length > 0x40 && asc(b, 0x3c, 'IM10')) return ['mpt', 'adplug'];
    if (asc(b, 0, 'DeFy DTM')) return ['adplug', 'mpt'];
    if (asc(b, 0, 'fLaC') || asc(b, 0, 'OggS') || asc(b, 0, 'ID3') || (asc(b, 0, 'RIFF') && asc(b, 8, 'WAVE'))) return ['pcm'];
  }
  if (MIDI_EXTS.has(e)) return ['midi', 'adplug', 'mpt'];
  if (HVL_EXTS.has(e)) return ['hvl'];
  if (GME_EXTS.has(e)) return e === 'ay' ? ['gme', 'caw'] : e === 'vgm' || e === 'vgz' ? vgmEngines(b) : ['gme', 'caw'];
  if (CAW_EXTS.has(e)) return ['caw'];
  if (e in PCM_EXTS) return ['pcm'];
  if (MPT_EXTS.has(e) && ADPLUG_EXTS.has(e)) return ['mpt', 'adplug'];
  if (MPT_EXTS.has(e)) return ['mpt', 'adplug'];
  if (ADPLUG_EXTS.has(e)) return ['adplug', 'mpt'];
  return ['mpt', 'adplug', 'gme', 'caw', 'pcm'];
}

// Files AdPlug may need next to the song (KSM, ROL, SCI, ...)
export function wantsCompanions(name) { return ['ksm', 'rol', 'sci', 'mdi', 'm', 'laa', 'sng', 'sdb', 'agd', 'ha2', 'xad', 'mkf', 'cmf', 'adl', 'got'].includes(ext(name)); }

export const ENGINE_NAMES = { mpt: 'libopenmpt', adplug: 'AdPlug', gme: 'Game Music Emu', hvl: 'HivelyTracker', midi: 'MIDI', caw: 'cawtooth', pcm: 'PCM' };

// Format list for the "Formats" help page (grouped like Open Cubic Player's README, plus additions)
export const FORMAT_GROUPS = [
  ['Tracker modules (libopenmpt)', 'MOD NST M15 STK WOW 669 AMF AMS C67 DBM DIGI DMF DSM DSYM DTM FAR FMT GDM ICE IMF IT J2B MDL MED MO3 MPTM MT2 MTM OKT PLM PSM PTM PT36 RTM S3M SFX SMOD STM STP STX SYMMOD ULT UMX XM XMF FC FC13 FC14 GT2 GTK GMC PUMA TCB UNIC MMS CBA ETX FTM, PowerPacker, MMCMP, XPK packed'],
  ['HivelyTracker / AHX', 'HVL AHX'],
  ['AdLib / OPL (AdPlug)', 'A2M A2T ADL AMD BAM BMF CFF CMF D00 DFM DMO DRO DTM FMK GOT HSC HSP HSQ IMF IMS JBM KSM LAA LDS M MAD MDI MDY MKJ MSC MTK MTR MUS PIS PLX RAC RAD RAW RIX ROL SA2 SAT SCI SDB SNG SOP SQX VGM (OPL) WLF WM XAD XMS XSM'],
  ['Consoles & home computers (Game Music Emu)', 'AY GBS GYM HES KSS NSF NSFE SAP SPC VGM VGZ'],
  ['C64, Atari ST, ZX Spectrum (cawtooth)', 'SID PSID RSID SNDH YM VTX PSG ASC PT2 PT3 STC TS, VGM (AY-3-8910)'],
  ['MIDI', 'MID MIDI RMI KAR SMF XMI, Doom MUS; OPL3 FM (libADLMIDI, 70+ banks) or your own SoundFont (SF2)'],
  ['Audio', 'WAV MP3 MP2 MP1 OGG OPUS FLAC M4A AAC ALAC WEBM QOA WV TTA APE MPC WMA AIFF CAF DSF DFF AC3 SPX'],
  ['Containers & lists', 'ZIP GZ TGZ TAR MDZ, CUE sheets, M3U, PLS'],
];
