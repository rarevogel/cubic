#!/usr/bin/env python3
"""Writes the built-in demo tune (an original composition for Cubic) as a Standard MIDI File."""
import struct, sys

TPQ = 96
def vlq(n):
    out = [n & 0x7f]; n >>= 7
    while n: out.insert(0, (n & 0x7f) | 0x80); n >>= 7
    return bytes(out)

class Track:
    def __init__(s): s.ev = []
    def note(s, t, ch, key, dur, vel): s.ev.append((t, bytes([0x90 | ch, key, vel]))); s.ev.append((t + dur, bytes([0x80 | ch, key, 0])))
    def raw(s, t, b): s.ev.append((t, b))
    def bytes(s):
        s.ev.sort(key=lambda e: (e[0], e[1][0] & 0xf0 != 0x80)); out = b''; last = 0
        for t, b in s.ev: out += vlq(t - last) + b; last = t
        out += vlq(0) + b'\xff\x2f\x00'
        return b'MTrk' + struct.pack('>I', len(out)) + out

B = TPQ * 4          # one bar
conductor = Track()
conductor.raw(0, b'\xff\x03' + bytes([len(b'Cubic Demo')]) + b'Cubic Demo')
conductor.raw(0, b'\xff\x01' + bytes([len(b'Original tune written for Cubic Player')]) + b'Original tune written for Cubic Player')
conductor.raw(0, b'\xff\x51\x03' + (60000000 // 132).to_bytes(3, 'big'))
conductor.raw(0, b'\xff\x58\x04\x04\x02\x18\x08')

t = Track()
# programs: lead, bass, pad, arp, counter melody
for ch, prog, vol, pan in [(0, 80, 100, 70), (1, 38, 110, 64), (2, 89, 70, 50), (3, 81, 72, 84), (4, 11, 80, 40)]:
    t.raw(0, bytes([0xc0 | ch, prog])); t.raw(0, bytes([0xb0 | ch, 7, vol])); t.raw(0, bytes([0xb0 | ch, 10, pan]))
t.raw(0, bytes([0xb9, 7, 105]))

# progression (A minor): Am F C G | Am F G E
prog1 = [(57, 'm'), (53, ''), (48, ''), (55, '')]
prog2 = [(57, 'm'), (53, ''), (55, ''), (52, '')]
def triad(root, q): return [root, root + (3 if q == 'm' else 4), root + 7]

lead_a = [(0, 76, 2), (2, 74, 1), (3, 72, 1), (4, 74, 2), (6, 76, 2), (8, 79, 3), (11, 77, 1), (12, 76, 2), (14, 72, 2)]
lead_b = [(0, 72, 2), (2, 74, 2), (4, 76, 1), (5, 77, 1), (6, 79, 2), (8, 81, 4), (12, 79, 2), (14, 76, 2)]
lead_c = [(0, 77, 2), (2, 76, 1), (3, 74, 1), (4, 72, 2), (6, 71, 2), (8, 72, 2), (10, 74, 2), (12, 76, 4)]
lead_d = [(0, 74, 3), (3, 72, 1), (4, 71, 2), (6, 72, 2), (8, 68, 4), (12, 71, 4)]
s16 = TPQ // 4

bars = 32
for bar in range(bars):
    t0 = bar * B
    section = bar // 8           # 0 intro, 1 theme, 2 theme+counter, 3 outro-ish
    pr = (prog1 if (bar // 4) % 2 == 0 else prog2)[bar % 4]
    root, q = pr
    ch = triad(root, q)
    # pad: sustained chord
    if section != 0 or bar % 2 == 0:
        for k in ch: t.note(t0, 2, k + 12, B - 4, 62)
    # bass: driving eighths with octave jumps
    if bar >= 2:
        for i in range(8):
            k = root - 24 + (12 if i % 4 == 3 else 0)
            t.note(t0 + i * TPQ // 2, 1, k, TPQ // 2 - 6, 100 if i % 2 == 0 else 80)
    # arpeggio: sixteenths over the chord
    if bar >= 4:
        pat = [0, 1, 2, 1, 2, 3, 2, 1]
        notes = ch + [ch[0] + 12]
        for i in range(16): t.note(t0 + i * s16, 3, notes[pat[i % 8]] + 12, s16 - 4, 58 + (10 if i % 4 == 0 else 0))
    # lead melody from bar 8
    if 8 <= bar < 30:
        phrase = [lead_a, lead_b, lead_c, lead_d][bar % 4]
        transpose = 0 if bar < 24 else 12
        for (pos, k, d) in phrase: t.note(t0 + pos * s16, 0, k + transpose - 12, d * s16 - 8, 104)
    # counter melody (bells) in the third section
    if 16 <= bar < 30 and bar % 2 == 1:
        for i, k in enumerate([ch[2] + 24, ch[1] + 24, ch[0] + 24, ch[1] + 24]): t.note(t0 + i * TPQ, 4, k, TPQ - 10, 70)
    # drums (GM channel 10)
    if bar >= 2 and bar < 31:
        for i in range(16):
            if i % 4 == 0: t.note(t0 + i * s16, 9, 36, s16, 112)          # kick
            if i in (4, 12): t.note(t0 + i * s16, 9, 38, s16, 100)        # snare
            if i % 2 == 0: t.note(t0 + i * s16, 9, 42, s16, 70 if i % 4 else 84)  # hat
            if bar % 4 == 3 and i >= 12: t.note(t0 + i * s16, 9, 45 + (i - 12) * 2, s16, 96)  # tom fill
        if bar % 8 == 0: t.note(t0, 9, 49, TPQ, 100)                        # crash
# final chord
end = bars * B
for k in triad(57, 'm'): t.note(end - B, 2, k + 12, B, 70); t.note(end - B, 0, k + 12, B - 10, 80)
t.note(end - B, 1, 33, B - 10, 100); t.note(end - B, 9, 49, TPQ, 100)

data = b'MThd' + struct.pack('>IHHH', 6, 1, 2, TPQ) + conductor.bytes() + t.bytes()
open(sys.argv[1] if len(sys.argv) > 1 else 'cubic-demo.mid', 'wb').write(data)
print(len(data), 'bytes')
