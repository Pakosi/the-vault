# Lighting bake (run on a Mac with Blender for Metal GPU)

    B=/Applications/Blender.app/Contents/MacOS/Blender
    export VAULT_ASSETS=$PWD/assets VAULT_CARS=$PWD/pipeline/cars VAULT_OUT=$PWD/build VAULT_BUILD=$PWD/build VAULT_GPU=1 RES=4096 SAMPLES=512
    $B -b --python pipeline/blender/scene.py
    $B -b --python pipeline/blender/bake.py
    mkdir -p bakes && cp build/lm/A.npz build/lm/B.npz build/lm/F.npz bakes/

Outputs (bakes/*.npz) are applied in the cloud build with REMOTE_LM.
