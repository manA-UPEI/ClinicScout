import type { Relevance, ClinicClassification } from "../entities/clinic.ts";

/**
 * OpenStreetMap's `amenity=clinic|doctors` covers everything from urgent care
 * to fertility labs and LASIK centres. Recommending a fertility clinic to
 * someone who needs care right now is the single worst failure this app can
 * produce, so listings are tiered before they reach the ranking.
 *
 * Classification only ever downgrades on *positive* evidence — a tag or a clear
 * name token. A listing we cannot place stays `unknown` and remains eligible,
 * mirroring the rule applied to every other unknown field: never guess.
 */

// These match word *stems*, so only the leading \b is anchored — a trailing one
// would break every inflected form ("optometr" inside "Optometrists" has no
// boundary after it). The leading \b is what keeps stems from matching
// mid-word.
//
// "Walk-in" describes how you get seen, not what they treat, so it is checked
// *after* specialty: a walk-in eye clinic still cannot look at your sore
// throat.
const WALK_IN = /\b(walk[\s-]?in|urgent care|after[\s-]?hours)/i;

const GENERAL =
  /\b(family (practice|medicine|health|doctor)|general practi(ce|tioner)|primary care|community health|medical (clinic|centre|center)|health (centre|center)|nurse practitioner)/i;

const SPECIALTY_NAMES: [RegExp, string][] = [
  [/\b(fertility|ivf|reproductive|obstetric)/i, "Fertility & reproductive"],
  [/\b(lasik|optometr|ophthalm|eye care|vision care)/i, "Eye care"],
  [/\b(dental|dentist|orthodont|denture|endodont)/i, "Dental"],
  [/\b(physio|physical therapy|chiroprac|massage|acupunctur|naturopath|osteopath|homeopath)/i, "Physical & alternative therapy"],
  [/\b(veterinar|animal hospital)/i, "Veterinary"],
  [/\b(cosmetic|aesthetic|dermatolog|botox|plastic surgery|med[\s-]?spa)/i, "Cosmetic & dermatology"],
  [/\b(psycholog|psychiatr|counsell?ing|behaviou?r|mental health|addiction|psychotherap)/i, "Mental & behavioural health"],
  [/\b(podiatr|chiropod|foot care)/i, "Podiatry"],
  [/\b(audiolog|hearing)/i, "Hearing"],
  [/\b(speech|occupational therapy)/i, "Speech & occupational therapy"],
  [/\b(radiolog|ultrasound|mri|x[\s-]?ray|imaging|laborator|phlebotom|blood (test|donation)|diagnostic)/i, "Imaging & lab"],
  [/\b(oncolog|cardiolog|neurolog|endocrin|gastroenterolog|urolog|nephrolog|rheumatolog|pulmonolog|allerg|immunolog|orthop(a)?ed|vascular|dialysis)/i, "Specialist referral"],
  [/\b(rehabilitat|sleep clinic|weight loss|hospice|palliative|midwif|pain (relief|releif|management|clinic))/i, "Specialised service"],
];

// OSM's own vocabulary, which is more reliable than the name when present.
const SPECIALTY_HEALTHCARE: Record<string, string> = {
  physiotherapist: "Physical & alternative therapy",
  optometrist: "Eye care",
  dentist: "Dental",
  alternative: "Physical & alternative therapy",
  psychotherapist: "Mental & behavioural health",
  counselling: "Mental & behavioural health",
  podiatrist: "Podiatry",
  audiologist: "Hearing",
  speech_therapist: "Speech & occupational therapy",
  occupational_therapist: "Speech & occupational therapy",
  laboratory: "Imaging & lab",
  sample_collection: "Imaging & lab",
  blood_donation: "Imaging & lab",
  dialysis: "Specialist referral",
  rehabilitation: "Specialised service",
  hospice: "Specialised service",
  midwife: "Fertility & reproductive",
  nutrition_counselling: "Specialised service",
  vaccination_centre: "Specialised service",
};

const GENERAL_SPECIALITIES = new Set([
  "general",
  "community",
  "family",
  "paediatrics",
  "pediatrics",
]);

const SPECIALITY_LABELS: [RegExp, string][] = [
  [/fertility|gynaecolog|gynecolog|obstetric/i, "Fertility & reproductive"],
  [/ophthalmolog|optometry/i, "Eye care"],
  [/dentist|orthodontics/i, "Dental"],
  [/physiotherapy|chiropractic/i, "Physical & alternative therapy"],
  [/psychiatry|psycholog|psychotherapy/i, "Mental & behavioural health"],
  [/dermatolog|plastic_surgery|cosmetic/i, "Cosmetic & dermatology"],
  [/radiolog|diagnostic/i, "Imaging & lab"],
];

function labelFor(patterns: [RegExp, string][], value: string): string | null {
  for (const [pattern, label] of patterns) {
    if (pattern.test(value)) return label;
  }
  return null;
}

export function classifyClinic(
  name: string,
  tags: Record<string, string>
): ClinicClassification {
  const healthcare = tags["healthcare"]?.toLowerCase();
  if (healthcare && SPECIALTY_HEALTHCARE[healthcare]) {
    return { relevance: "specialty", specialty: SPECIALTY_HEALTHCARE[healthcare] };
  }

  // `healthcare:speciality` is a semicolon-separated list; a listing counts as
  // general practice if any value says so, since those clinics treat walk-ins.
  const speciality = tags["healthcare:speciality"]?.toLowerCase() ?? "";
  const values = speciality.split(";").map((v) => v.trim()).filter(Boolean);
  if (values.some((v) => GENERAL_SPECIALITIES.has(v))) {
    return { relevance: "general", specialty: null };
  }
  if (values.length > 0) {
    return {
      relevance: "specialty",
      specialty: labelFor(SPECIALITY_LABELS, speciality) ?? "Specialist referral",
    };
  }

  const nameSpecialty = labelFor(SPECIALTY_NAMES, name);
  if (nameSpecialty) return { relevance: "specialty", specialty: nameSpecialty };

  if (WALK_IN.test(name)) return { relevance: "walk_in", specialty: null };

  if (GENERAL.test(name)) return { relevance: "general", specialty: null };

  return { relevance: "unknown", specialty: null };
}

/** Higher tiers rank first; `specialty` never reaches ranking at all. */
export function relevanceScore(relevance: Relevance): number {
  switch (relevance) {
    case "walk_in":
      return 0;
    case "general":
      return 1;
    case "unknown":
      return 2;
    case "specialty":
      return 3;
  }
}
