# Cuts the recorded frames (e2e/var/demo/frames.json from record.mjs) into e2e/var/demo/demo.mp4.
# Each frame lasts until the next one, divided by the speed in force; fast stretches get a "N× speed" tag.
# Run: python3 e2e/demo/cut.py
import bisect, json, subprocess
from pathlib import Path

D = Path(__file__).resolve().parent.parent / 'var' / 'demo'
FONT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
j = json.loads((D / 'frames.json').read_text())
frames, marks = j['frames'], sorted(j['marks'], key=lambda m: m['t'])
mt = [m['t'] for m in marks]
speed_at = lambda t: marks[bisect.bisect_right(mt, t) - 1]['speed'] if mt and t >= mt[0] else 1

lines, fast, out_t = [], [], 0.0
for i, f in enumerate(frames):
    s = speed_at(f['t'])
    if s == 0: continue  # speed 0 = cut
    dur = 1.6 if i == len(frames) - 1 else min((frames[i + 1]['t'] - f['t']) / 1000 / s, 4.0)  # ponytail: a frame never holds > 4 s
    if dur < 0.001: continue
    lines += [f"file '{f['f']}'", f'duration {dur:.4f}']
    if s >= 2: fast.append((out_t, out_t + dur, s))
    out_t += dur
lines.append(f"file '{frames[-1]['f']}'")  # concat demuxer ignores the last duration otherwise
(D / 'list.txt').write_text('\n'.join(lines) + '\n')

# merge adjacent fast spans with the same speed into one drawtext each
spans = []
for a, b, s in fast:
    if spans and spans[-1][2] == s and a - spans[-1][1] < 0.05: spans[-1][1] = b
    else: spans.append([a, b, s])
tags = ''.join(
    f",drawtext=fontfile='{FONT}':text='{s:g}× speed':fontsize=26:fontcolor=white:box=1:boxcolor=0x111111AA:boxborderw=12:x=w-tw-36:y=36:enable='between(t,{a:.3f},{b:.3f})'"
    for a, b, s in spans if b - a > 0.4)
vf = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x141210,fps=30,format=yuv420p' + tags
subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
                '-vf', vf, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', 'demo.mp4'], cwd=D, check=True)
print(f'demo.mp4 · {out_t:.1f} s · {len(frames)} frames')
