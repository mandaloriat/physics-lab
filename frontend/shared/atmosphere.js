/**
 * The International Standard Atmosphere, and the dimensionless groups that follow from it.
 *
 * An exercise's physical inputs have to be a *situation*, not a list of fluid properties: "sea
 * level" is one decision, and density, viscosity, pressure, temperature and the speed of sound
 * are its four or five consequences. That is what this module is for.
 *
 * The altitude is resolved here, in the browser, and the resolved properties are what the
 * solver receives — so the solver never carries a table it would have to keep in step with
 * this one, and the run row records both the altitude chosen and the numbers sent.
 *
 * Reference: NASA's standard-atmosphere pages, and the ICAO constants below. The five-row
 * table in `docs/exercises/airfoil.md` §5.3 is what this is checked against.
 */

/** Sea-level base, ICAO. */
const T0 = 288.15; // K
const P0 = 101325.0; // Pa
const LAPSE = 0.0065; // K/m, troposphere
const R_AIR = 287.05287; // J/(kg K)
const G0 = 9.80665; // m/s^2
const GAMMA = 1.4;

/** Tropopause: above it the temperature is constant and the pressure decays exponentially. */
const H_TROPOPAUSE = 11000.0; // m
const T_TROPOPAUSE = 216.65; // K

/** Sutherland's law, for viscosity. */
const MU_REF = 1.716e-5; // Pa s
const T_REF = 273.15; // K
const S_SUTHERLAND = 110.4; // K

/** The exponent g/(L R) = 5.25588, written as the division so the constants stay visible. */
const EXPONENT = G0 / (LAPSE * R_AIR);

const P_TROPOPAUSE = P0 * (T_TROPOPAUSE / T0) ** EXPONENT;

/**
 * Air properties at a geopotential altitude, in SI.
 *
 * Valid to 20 km, which is past anything this lab has a reason to ask about. Above the
 * tropopause the lapse rate is zero, so the barometric formula changes shape — the two
 * branches are the physics, not a special case.
 *
 * @param {number} altitude metres
 * @returns {{altitude: number, temperature: number, pressure: number, density: number,
 *   viscosity: number, soundSpeed: number}}
 */
export function isa(altitude) {
  const h = Math.min(Math.max(altitude, 0), 20000);

  let temperature;
  let pressure;
  if (h <= H_TROPOPAUSE) {
    temperature = T0 - LAPSE * h;
    pressure = P0 * (temperature / T0) ** EXPONENT;
  } else {
    temperature = T_TROPOPAUSE;
    pressure = P_TROPOPAUSE * Math.exp((-G0 * (h - H_TROPOPAUSE)) / (R_AIR * T_TROPOPAUSE));
  }

  return {
    altitude: h,
    temperature,
    pressure,
    density: pressure / (R_AIR * temperature),
    viscosity: sutherland(temperature),
    soundSpeed: Math.sqrt(GAMMA * R_AIR * temperature),
  };
}

/** Dynamic viscosity from temperature alone — it does not depend on pressure. */
export function sutherland(temperature) {
  return (
    MU_REF * (temperature / T_REF) ** 1.5 * ((T_REF + S_SUTHERLAND) / (temperature + S_SUTHERLAND))
  );
}

/**
 * The dimensionless groups. Computed, never typed in.
 *
 * At level 1 nothing in the model depends on either of them, and they are shown anyway: the
 * Mach number is what says when the incompressible assumption has been left behind, and the
 * Reynolds number is what makes two runs at different chords and speeds comparable at all.
 * That Reynolds appears and changes nothing is the honest statement about this model.
 */
export function groups({ speed, chord, density, viscosity, soundSpeed }) {
  return {
    reynolds: (density * speed * chord) / viscosity,
    mach: speed / soundSpeed,
    dynamicPressure: 0.5 * density * speed * speed,
  };
}
