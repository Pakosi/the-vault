"""Denoise float images with Blender's bundled OpenImageDenoise via ctypes. usage: python3 tools_oidn.py in.npy out.npy"""
import ctypes, sys, os, numpy as np
LIB = '/home/claude/bvenv/lib/python3.13/site-packages/bpy/lib'
for dep in sorted(os.listdir(LIB)):
    if dep.startswith('libtbb') and '.so' in dep:
        try: ctypes.CDLL(os.path.join(LIB, dep), mode=ctypes.RTLD_GLOBAL)
        except OSError: pass
o = ctypes.CDLL(os.path.join(LIB, 'libOpenImageDenoise.so.2'))
o.oidnNewDevice.restype = ctypes.c_void_p
o.oidnNewFilter.restype = ctypes.c_void_p; o.oidnNewFilter.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
o.oidnCommitDevice.argtypes = [ctypes.c_void_p]
o.oidnSetSharedFilterImage.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t]
o.oidnSetFilterBool.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_bool]
o.oidnCommitFilter.argtypes = [ctypes.c_void_p]; o.oidnExecuteFilter.argtypes = [ctypes.c_void_p]
o.oidnGetDeviceError.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_char_p)]


def denoise(rgb):
    rgb = np.ascontiguousarray(rgb, dtype=np.float32); out = np.zeros_like(rgb)
    H, W = rgb.shape[:2]
    dev = o.oidnNewDevice(1); o.oidnCommitDevice(dev)
    f = o.oidnNewFilter(dev, b'RT')
    o.oidnSetSharedFilterImage(f, b'color', rgb.ctypes.data, 3, W, H, 0, 0, 0)
    o.oidnSetSharedFilterImage(f, b'output', out.ctypes.data, 3, W, H, 0, 0, 0)
    o.oidnSetFilterBool(f, b'hdr', True)
    o.oidnCommitFilter(f); o.oidnExecuteFilter(f)
    err = ctypes.c_char_p(); code = o.oidnGetDeviceError(dev, ctypes.byref(err))
    if code: raise RuntimeError(err.value)
    return out


if __name__ == '__main__':
    a = np.load(sys.argv[1]).astype(np.float32)
    a[..., :3] = denoise(a[..., :3])
    np.save(sys.argv[2], a.astype(np.float16)); print('ok')
