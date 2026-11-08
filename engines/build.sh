#!/bin/sh
# Builds the WebAssembly engines (adplug.wasm, gme.wasm, hvl.wasm, midi.wasm, speex.wasm) with zig's clang.
#   pip install ziglang            (zig 0.13+; tested with 0.17.1)
#   ./build.sh [source-dir]        (default: ./src, cloned here at the pinned commits)
set -e
cd "$(dirname "$0")"
SRC=${1:-src}
OUT=${OUT:-.}
mkdir -p "$SRC" obj/adplug obj/gme obj/adl
fetch() { # name url commit
  [ -d "$SRC/$1" ] || { git clone -q "$2" "$SRC/$1" && git -C "$SRC/$1" checkout -q "$3"; }
}
fetch adplug https://github.com/adplug/adplug.git 3d9457ac91121302a752577b2bf063b4aea202b8
fetch libbinio https://github.com/adplug/libbinio.git 3baed731da6b44883c6820132fb1d2a44abc0939
fetch game-music-emu https://github.com/libgme/game-music-emu.git 8238afd9503a59ffcec0e2685584d5ce819ad7c6
fetch libADLMIDI https://github.com/Wohlstand/libADLMIDI.git d77cc11c794779e768fb14f5aa0620070348d4ee
fetch TinySoundFont https://github.com/schellingb/TinySoundFont.git 853a0a171759f1ddba0de1442133a75912bbeffa
fetch speex https://github.com/xiph/speex.git 09b569d1b437e5edccf3406a38714ad795e46d38
# HivelyTracker replayer: patched copy in hvlsrc/ (from pete-gordon/hivelytracker f393ca7c)

ZCC="python3 -m ziglang cc -target wasm32-wasi -O2 -mexec-model=reactor -Wno-everything"
ZXX="python3 -m ziglang c++ -target wasm32-wasi -O2 -mexec-model=reactor -fno-exceptions -Wno-everything"
LINK="-Wl,--export-dynamic -Wl,--strip-all"

# ---- AdPlug (+ libbinio) ----
S=$SRC/adplug/src; L=$SRC/libbinio/src
for c in $S/*.c; do $ZCC -I$S -Igen -c "$c" -o obj/adplug/$(basename "$c").o; done
$ZXX -std=c++14 -Dstricmp=strcasecmp -include strings.h -Igen -I$S -I$L $LINK -o $OUT/adplug.wasm adplug_eng.cpp \
  $(ls $S/*.cpp | grep -v -e realopl -e analopl -e diskopl) $L/binio.cpp $L/binstr.cpp obj/adplug/*.o

# ---- Game Music Emu ----
G=$SRC/game-music-emu/gme
sed -e 's/#cmakedefine/#define/' -e 's/@[A-Z_]*@//g' $G/gme_types.h.in > gen/gme_types.h 2>/dev/null || true
$ZCC -c $G/ext/emu2413.c -o obj/gme/emu2413.o
$ZXX -std=c++14 -DBLARGG_LITTLE_ENDIAN=1 -DVGM_YM2612_NUKED -DHAVE_STDINT_H \
  -DUSE_GME_AY -DUSE_GME_GBS -DUSE_GME_GYM -DUSE_GME_HES -DUSE_GME_KSS -DUSE_GME_NSF -DUSE_GME_NSFE -DUSE_GME_SAP -DUSE_GME_SPC -DUSE_GME_VGM \
  -Igen -I$G -I$G/ext $LINK -o $OUT/gme.wasm gme_eng.cpp $(ls $G/*.cpp | grep -v -e Ym2612_GENS -e Ym2612_MAME) obj/gme/emu2413.o

# ---- HivelyTracker / AHX ----
$ZCC -Ihvlsrc $LINK -o $OUT/hvl.wasm hvl_eng.c hvlsrc/hvl_replay.c hvlsrc/hvl_tables.c

# ---- MIDI: libADLMIDI (Nuked OPL3) + TinySoundFont ----
A=$SRC/libADLMIDI
sed -i 's/throw std::bad_alloc();/abort();/' $A/src/structures/pl_list.tcc
for c in $A/src/models/*.c $A/src/chips/nuked/nukedopl2.c $A/src/chips/nuked_fast/nukedopl3_fast.c $A/src/chips/nuked_cqm/cqm.c; do
  $ZCC -I$A/include -I$A/src -c "$c" -o obj/adl/$(basename "$c").o; done
$ZCC -I$A/src -c $A/src/chips/nuked/nukedopl3.c -o obj/adl/nukedopl3.o
$ZCC -I$A/src -c $A/src/wopl/wopl_file.c -o obj/adl/wopl.o
ADLDEF="-DADLMIDI_DISABLE_DOSBOX_EMULATOR -DADLMIDI_DISABLE_OPAL_EMULATOR -DADLMIDI_DISABLE_JAVA_EMULATOR -DADLMIDI_DISABLE_ESFMU_EMULATOR \
  -DADLMIDI_DISABLE_MAME_OPL2_EMULATOR -DADLMIDI_DISABLE_YMFM_EMULATOR -DADLMIDI_DISABLE_YM3812_LLE_EMULATOR -DADLMIDI_DISABLE_YMF262_LLE_EMULATOR \
  -DADLMIDI_DISABLE_VPC_EMULATOR -DADLMIDI_DISABLE_HW_SERIAL"
$ZXX -std=c++14 $ADLDEF -I$A/include -I$A/src -I$SRC/TinySoundFont $LINK -o $OUT/midi.wasm midi_eng.cpp \
  $A/src/adlmidi.cpp $A/src/adlmidi_load.cpp $A/src/adlmidi_midiplay.cpp $A/src/adlmidi_opl3.cpp $A/src/adlmidi_private.cpp \
  $A/src/adlmidi_sequencer.cpp $A/src/inst_db.cpp $A/src/chips/nuked_opl3.cpp $A/src/chips/nuked_opl3_fast.cpp \
  $A/src/chips/nuked_opl2.cpp $A/src/chips/nuked_cqm.cpp obj/adl/*.o

# ---- Speex (for Ogg Speex .spx) ----
P=$SRC/speex/libspeex
$ZCC -DHAVE_CONFIG_H -Ispeexgen -I$SRC/speex/include -include speexgen/config.h $LINK -o $OUT/speex.wasm speex_eng.c \
  $(ls $P/*.c | grep -v -e testenc -e vorbis_psy -e fftwrap -e kiss_fft -e smallft)

ls -la $OUT/*.wasm
