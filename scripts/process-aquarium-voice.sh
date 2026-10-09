#!/bin/sh
set -eu

# The original recording stays untouched. Keep the pauses between all lines.
input_audio=${1:?Usage: process-aquarium-voice.sh INPUT_AUDIO [OUTPUT_MP3]}
output_audio=${2:-public/aquarium/glass-warning.mp3}
ffmpeg -hide_banner -loglevel error -i "$input_audio" \
  -af 'atrim=start=1.20:end=5.65,asetpts=PTS-STARTPTS,highpass=f=65,afftdn=nf=-35,rubberband=pitch=0.7071067812:tempo=1:pitchq=quality,bass=g=3:f=140:w=0.6,loudnorm=I=-16:TP=-2:LRA=7,volume=1.6,asoftclip=type=tanh:threshold=0.65:output=0.9:oversample=4,lowpass=f=6000,loudnorm=I=-18:TP=-2:LRA=7,afade=t=in:d=0.008,afade=t=out:st=4.415:d=0.035' \
  -ac 1 -ar 44100 -c:a libmp3lame -b:a 96k -map_metadata -1 -y "$output_audio"
