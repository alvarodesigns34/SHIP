/**
 * ALCIÓN HX-4 · ASCENSION — shaders de postproceso explícitos del pipeline.
 *
 * Todos los shaders están escritos en GLSL ES 1.00 portable (WebGL2 compatible),
 * con guardas frente a NaN/Inf y salida temprana para cielo/Tierra en AO.
 */

export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const PREFILTER = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float threshold;
uniform float knee;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  c += texture2D(tSrc, vUv + texel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2( 1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(-1.0,  1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2( 1.0,  1.0)).rgb;
  c *= 0.25;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float contrib = max(soft, br - threshold) / max(br, 1e-4);
  gl_FragColor = vec4(min(max(c * contrib, vec3(0.0)), vec3(64.0)), 1.0);
}`;

export const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec3 a = texture2D(tSrc, vUv + texel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + texel * vec2( 1.0, -1.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + texel * vec2(-1.0,  1.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + texel * vec2( 1.0,  1.0)).rgb;
  vec3 e = texture2D(tSrc, vUv).rgb;
  gl_FragColor = vec4((a + b + c + d) * 0.125 + e * 0.5, 1.0);
}`;

export const UP = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tPrev;
uniform vec2 texel;
uniform float radius;
varying vec2 vUv;
void main() {
  vec2 t = texel * radius;
  vec3 s = texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb
         + texture2D(tSrc, vUv + vec2(-t.x,  t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x,  t.y)).rgb;
  s += 2.0 * (texture2D(tSrc, vUv + vec2(0.0, -t.y)).rgb + texture2D(tSrc, vUv + vec2(0.0,  t.y)).rgb
            + texture2D(tSrc, vUv + vec2(-t.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2( t.x, 0.0)).rgb);
  s += 4.0 * texture2D(tSrc, vUv).rgb;
  gl_FragColor = vec4(texture2D(tPrev, vUv).rgb + s / 16.0, 1.0);
}`;

/**
 * Auto-exposición 100 % GPU — pasada inicial (RT HDR → 64×64):
 * log-luminancia ponderada por centro, con atenuación de vacío espacial puro y guarda contra NaN.
 */
export const LUMA_INIT = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 texel;
varying vec2 vUv;
float safeLuma(vec3 c) {
  float l = dot(max(c, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
  return (l > 0.0 && l < 1e4) ? l : 0.0;
}
void main() {
  vec2 off = texel * 1.5;
  float l0 = safeLuma(texture2D(tSrc, vUv + vec2(-off.x, -off.y)).rgb);
  float l1 = safeLuma(texture2D(tSrc, vUv + vec2( off.x, -off.y)).rgb);
  float l2 = safeLuma(texture2D(tSrc, vUv + vec2(-off.x,  off.y)).rgb);
  float l3 = safeLuma(texture2D(tSrc, vUv + vec2( off.x,  off.y)).rgb);
  float avg = (l0 + l1 + l2 + l3) * 0.25;
  vec2 d = vUv - 0.5;
  float centerW = mix(0.35, 1.0, exp(-dot(d, d) * 6.0));
  // El vacío espacial puro pesa menos para no sobreexponer el casco al sol, pero no se anula
  float spaceW = mix(0.15, 1.0, smoothstep(0.002, 0.02, avg));
  float w = centerW * spaceW;
  float logL = log2(clamp(avg, 0.002, 32.0));
  gl_FragColor = vec4(logL * w, w, 0.0, 1.0);
}`;

/** Reducción 4×4 por bilineal (64→16→4→1) conservando (logL ponderado, suma de pesos). */
export const LUMA_DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec2 a = texture2D(tSrc, vUv + texel * vec2(-1.0, -1.0)).rg;
  vec2 b = texture2D(tSrc, vUv + texel * vec2( 1.0, -1.0)).rg;
  vec2 c = texture2D(tSrc, vUv + texel * vec2(-1.0,  1.0)).rg;
  vec2 d = texture2D(tSrc, vUv + texel * vec2( 1.0,  1.0)).rg;
  gl_FragColor = vec4((a + b + c + d) * 0.25, 0.0, 1.0);
}`;

/** Integración temporal 1×1 ping-pong en GPU: rápida al encandilarse, pausada en penumbra. */
export const ADAPT = /* glsl */ `
uniform sampler2D tLuma;
uniform sampler2D tPrev;
uniform float dt;
uniform float reset;
uniform float keyValue;
uniform float minGain;
uniform float maxGain;
varying vec2 vUv;
void main() {
  vec2 lw = texture2D(tLuma, vec2(0.5)).rg;
  float avgLog = lw.r / max(lw.g, 1e-4);
  float avgLuma = clamp(exp2(avgLog), 0.003, 16.0);
  float rawGain = keyValue / max(avgLuma, 0.025);
  float targetGain = clamp(pow(rawGain, 0.52), minGain, maxGain);
  float prevGain = texture2D(tPrev, vec2(0.5)).r;
  if (!(prevGain > 0.1 && prevGain < 10.0)) prevGain = 1.0;
  float speed = targetGain < prevGain ? 2.8 : 0.9;
  float alpha = reset > 0.5 ? 1.0 : (1.0 - exp(-clamp(dt, 0.0, 0.25) * speed));
  float outGain = mix(prevGain, targetGain, alpha);
  gl_FragColor = vec4(outGain, avgLuma, targetGain, 1.0);
}`;

/**
 * AO de contacto ligero en espacio de pantalla (HBAO/GTAO 6 muestras en espiral, ½ res).
 * Lee la profundidad resuelta de la escena cercana (el cielo/Tierra tiene depth == 1.0 → AO = 1.0 exacto).
 */
export const AO_GEN = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 depthTexel;
uniform vec2 aoTexel;
uniform float camNear;
uniform float camFar;
uniform float tanHalfFov;
uniform float aspect;
uniform float radius;
uniform float bias;
uniform float farFade;
varying vec2 vUv;

float linDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * camNear * camFar) / max(camFar + camNear - z * (camFar - camNear), 1e-5);
}

vec3 viewPosAt(vec2 uv, float z) {
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc.x * tanHalfFov * aspect * z, ndc.y * tanHalfFov * z, -z);
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  float d0 = texture2D(tDepth, vUv).r;
  if (d0 >= 0.9999) {
    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    return;
  }
  float z0 = linDepth(d0);
  if (z0 > farFade) {
    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 p0 = viewPosAt(vUv, z0);

  // Normal de vista por derivada mínima (evita halos oscuros en bordes de silueta)
  vec2 stepUV = depthTexel * 2.0;
  float zL = linDepth(texture2D(tDepth, vUv - vec2(stepUV.x, 0.0)).r);
  float zR = linDepth(texture2D(tDepth, vUv + vec2(stepUV.x, 0.0)).r);
  float zD = linDepth(texture2D(tDepth, vUv - vec2(0.0, stepUV.y)).r);
  float zU = linDepth(texture2D(tDepth, vUv + vec2(0.0, stepUV.y)).r);

  vec3 dX = abs(zR - z0) < abs(z0 - zL)
    ? (viewPosAt(vUv + vec2(stepUV.x, 0.0), zR) - p0)
    : (p0 - viewPosAt(vUv - vec2(stepUV.x, 0.0), zL));
  vec3 dY = abs(zU - z0) < abs(z0 - zD)
    ? (viewPosAt(vUv + vec2(0.0, stepUV.y), zU) - p0)
    : (p0 - viewPosAt(vUv - vec2(0.0, stepUV.y), zD));
  vec3 N = normalize(cross(dX, dY));

  float radiusUV = clamp((radius / max(z0, 0.08)) / (2.0 * tanHalfFov), aoTexel.y * 2.0, 0.075);
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  float jit = ign(gl_FragCoord.xy + vec2(17.0, 31.0));

  float occ = 0.0;
  // 3 direcciones × 2 pasos = 6 muestras en espiral
  for (int i = 0; i < 3; i++) {
    float ang = rot + float(i) * 2.0943951;
    vec2 dir = vec2(cos(ang) / aspect, sin(ang));
    for (int s = 1; s <= 2; s++) {
      float frac = (float(s) - 0.35 + 0.35 * jit) * 0.5;
      vec2 suv = vUv + dir * (radiusUV * frac);
      if (suv.x <= 0.001 || suv.x >= 0.999 || suv.y <= 0.001 || suv.y >= 0.999) continue;
      float ds = texture2D(tDepth, suv).r;
      if (ds >= 0.9999) continue;
      float zs = linDepth(ds);
      vec3 v = viewPosAt(suv, zs) - p0;
      float dist = length(v);
      if (dist < 1e-4) continue;
      float ndotv = dot(N, v / dist);
      float falloff = clamp(1.0 - dist / (radius * 1.35), 0.0, 1.0);
      float rangeW = smoothstep(radius * 1.8, radius * 0.4, abs(zs - z0));
      occ += max(0.0, ndotv - bias) * falloff * falloff * rangeW;
    }
  }
  float ao = clamp(1.0 - (occ / 6.0) * 2.35, 0.18, 1.0);
  float distFade = 1.0 - smoothstep(farFade * 0.65, farFade, z0);
  ao = mix(1.0, ao, distFade);
  gl_FragColor = vec4(ao, z0, 0.0, 1.0);
}`;

/** Blur bilateral 3×3 consciente de la profundidad (½ res). */
export const AO_BLUR = /* glsl */ `
uniform sampler2D tAo;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec2 c = texture2D(tAo, vUv).rg;
  if (c.g <= 0.001) {
    gl_FragColor = vec4(1.0);
    return;
  }
  float z0 = c.g;
  float zScale = max(z0 * 0.055, 0.035);
  float sum = c.r * 4.0;
  float wsum = 4.0;

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) continue;
      vec2 s = texture2D(tAo, vUv + vec2(float(dx), float(dy)) * texel).rg;
      if (s.g <= 0.001) continue;
      float sw = (dx == 0 || dy == 0) ? 2.0 : 1.0;
      float dz = abs(s.g - z0) / zScale;
      float wz = exp(-dz * dz);
      float w = sw * wz;
      sum += s.r * w;
      wsum += w;
    }
  }
  float ao = clamp(sum / max(wsum, 1e-4), 0.15, 1.0);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}`;

/**
 * Pasada final: AO de contacto · auto-exposición GPU · bloom · AgX · salida LDR (con luma en .a para FXAA).
 */
export const FINAL = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tAdapt;
uniform sampler2D tAo;
uniform float exposure;
uniform float useAutoExp;
uniform float bloomStrength;
uniform float aoStrength;
uniform float applyDither;
uniform int mode;
uniform vec2 resolution;
varying vec2 vUv;

// AgX (Troy Sobotka) — aproximación polinómica de Benjamin Wrensch
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 c) {
  const mat3 inM = mat3(
    0.842479062253094, 0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772, 0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104
  );
  const mat3 outM = mat3(
    1.19687900512017, -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
    -0.0990297440797205, -0.0989611768448433, 1.15107367264116
  );
  c = inM * c;
  c = clamp(log2(max(c, vec3(1e-10))), -12.47393, 4.026069);
  c = (c + 12.47393) / 16.500999;
  c = agxContrast(c);
  // ligero "punch" para que los materiales no queden lavados
  c = pow(max(c, 0.0), vec3(1.08));
  c = outM * c;
  return clamp(c, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 hdr = texture2D(tScene, vUv).rgb;
  if (mode == 3) { gl_FragColor = vec4(toSRGB(clamp(hdr, 0.0, 1.0)), 1.0); return; }
  float ao = texture2D(tAo, vUv).r;
  if (mode == 6) { gl_FragColor = vec4(vec3(ao), 1.0); return; }
  vec3 bl = texture2D(tBloom, vUv).rgb;
  if (mode == 4) { gl_FragColor = vec4(toSRGB(clamp(bl * 4.0, 0.0, 1.0)), 1.0); return; }

  float aoMod = mix(1.0, ao, aoStrength);
  float autoGain = useAutoExp > 0.5 ? texture2D(tAdapt, vec2(0.5)).r : 1.0;
  if (!(autoGain > 0.2 && autoGain < 4.0)) autoGain = 1.0;
  float expTotal = exposure * autoGain;

  vec3 c = hdr * aoMod * expTotal + bl * bloomStrength * expTotal;
  if (mode == 5) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(vec3(l > 1.0 ? 1.0 : 0.0, l < 0.02 ? 1.0 : 0.0, clamp(l, 0.0, 1.0)), 1.0);
    return;
  }
  c = agx(c);
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  if (applyDither > 0.5) c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(c, applyDither > 0.5 ? 1.0 : luma);
}`;

/**
 * FXAA 3.11 de alta calidad post-AgX para bordes especulares/subpíxel (costillas grafito,
 * marcos metálicos, cables finos y perfil baja sin MSAA).
 * subpixQuality conservador (~0.45) para preservar la nitidez del texto de pantallas MFD y etiquetas.
 */
export const FXAA = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float subpixQuality;
uniform float edgeThreshold;
uniform float edgeThresholdMin;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec4 center = texture2D(tSrc, vUv);
  float lM = center.a;
  float lN = texture2D(tSrc, vUv + vec2(0.0,  texel.y)).a;
  float lS = texture2D(tSrc, vUv + vec2(0.0, -texel.y)).a;
  float lE = texture2D(tSrc, vUv + vec2( texel.x, 0.0)).a;
  float lW = texture2D(tSrc, vUv + vec2(-texel.x, 0.0)).a;

  float lMin = min(lM, min(min(lN, lS), min(lE, lW)));
  float lMax = max(lM, max(max(lN, lS), max(lE, lW)));
  float lRange = lMax - lMin;

  if (lRange < max(edgeThresholdMin, lMax * edgeThreshold)) {
    gl_FragColor = vec4(center.rgb + (hash(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
    return;
  }

  float lNW = texture2D(tSrc, vUv + vec2(-texel.x,  texel.y)).a;
  float lNE = texture2D(tSrc, vUv + vec2( texel.x,  texel.y)).a;
  float lSW = texture2D(tSrc, vUv + vec2(-texel.x, -texel.y)).a;
  float lSE = texture2D(tSrc, vUv + vec2( texel.x, -texel.y)).a;

  float lNS = lN + lS;
  float lEW = lE + lW;
  float lCorners = lNW + lNE + lSW + lSE;

  float edgeH = abs(-2.0 * lW + lNW + lSW) + abs(-2.0 * lM + lNS) * 2.0 + abs(-2.0 * lE + lNE + lSE);
  float edgeV = abs(-2.0 * lN + lNW + lNE) + abs(-2.0 * lM + lEW) * 2.0 + abs(-2.0 * lS + lSW + lSE);
  bool isHorz = edgeH >= edgeV;

  float l1 = isHorz ? lS : lW;
  float l2 = isHorz ? lN : lE;
  float g1 = abs(l1 - lM);
  float g2 = abs(l2 - lM);
  bool is1Steepest = g1 >= g2;
  float gradScaled = 0.25 * max(g1, g2);

  float stepLen = isHorz ? texel.y : texel.x;
  float lLocalAvg = 0.0;
  if (is1Steepest) {
    stepLen = -stepLen;
    lLocalAvg = 0.5 * (l1 + lM);
  } else {
    lLocalAvg = 0.5 * (l2 + lM);
  }

  vec2 curUv = vUv;
  if (isHorz) curUv.y += stepLen * 0.5;
  else curUv.x += stepLen * 0.5;

  vec2 offset = isHorz ? vec2(texel.x, 0.0) : vec2(0.0, texel.y);
  vec2 uv1 = curUv - offset;
  vec2 uv2 = curUv + offset;

  float lEnd1 = texture2D(tSrc, uv1).a - lLocalAvg;
  float lEnd2 = texture2D(tSrc, uv2).a - lLocalAvg;
  bool reached1 = abs(lEnd1) >= gradScaled;
  bool reached2 = abs(lEnd2) >= gradScaled;
  if (!reached1) uv1 -= offset;
  if (!reached2) uv2 += offset;

  if (!reached1 || !reached2) {
    for (int i = 0; i < 6; i++) {
      float mul = (i < 2) ? 1.0 : (i < 4) ? 2.0 : 4.0;
      if (!reached1) lEnd1 = texture2D(tSrc, uv1).a - lLocalAvg;
      if (!reached2) lEnd2 = texture2D(tSrc, uv2).a - lLocalAvg;
      reached1 = abs(lEnd1) >= gradScaled;
      reached2 = abs(lEnd2) >= gradScaled;
      if (reached1 && reached2) break;
      if (!reached1) uv1 -= offset * mul;
      if (!reached2) uv2 += offset * mul;
    }
  }

  float dist1 = isHorz ? (vUv.x - uv1.x) : (vUv.y - uv1.y);
  float dist2 = isHorz ? (uv2.x - vUv.x) : (uv2.y - vUv.y);
  bool dir1 = dist1 < dist2;
  float distFinal = min(dist1, dist2);
  float edgeThick = dist1 + dist2;
  float pixelOffset = -distFinal / max(edgeThick, 1e-5) + 0.5;

  bool isCenterSmaller = lM < lLocalAvg;
  bool correctVar = ((dir1 ? lEnd1 : lEnd2) < 0.0) != isCenterSmaller;
  float finalOffset = correctVar ? pixelOffset : 0.0;

  // Subpixel AA conservador (evita emborronar texto fino en pantallas MFD)
  float lAvg = (1.0 / 12.0) * (2.0 * (lNS + lEW) + lCorners);
  float subpix1 = clamp(abs(lAvg - lM) / max(lRange, 1e-5), 0.0, 1.0);
  float subpix2 = (-2.0 * subpix1 + 3.0) * subpix1 * subpix1;
  float subpixOffset = subpix2 * subpix2 * subpixQuality;
  finalOffset = max(finalOffset, subpixOffset);

  vec2 finalUv = vUv;
  if (isHorz) finalUv.y += finalOffset * stepLen;
  else finalUv.x += finalOffset * stepLen;

  vec3 col = texture2D(tSrc, finalUv).rgb;
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;
