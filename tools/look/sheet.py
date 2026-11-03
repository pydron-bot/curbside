import sys
from PIL import Image
d, prefix, out = sys.argv[1], sys.argv[2], sys.argv[3]
names=[f'{prefix}-{v}-{h}.png' for v in ['spawn','downtown','arts'] for h in ['day','dusk','night']]
ims=[Image.open(f'{d}/{n}') for n in names]
w,h=ims[0].size; s=0.5 if w>1000 else 0.6
W,H=int(w*s),int(h*s)
sh=Image.new('RGB',(W*3,H*3))
for i,im in enumerate(ims): sh.paste(im.resize((W,H)),((i%3)*W,(i//3)*H))
sh.save(out)
