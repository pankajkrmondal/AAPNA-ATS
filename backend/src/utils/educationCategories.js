/**
 * Education category rules shared by the screening searches.
 *
 * Moved verbatim out of screening.service.js (2026-10-13) so the strict-filter
 * utilities (screeningFilters.js) can apply the education filter without
 * importing the service — which opens Prisma and Redis connections at import
 * time and so cannot be loaded by a pure unit test. Behaviour is unchanged;
 * the service imports these back from here.
 */

/**
 * Helper: Matches Qualification checks
 */
export function matchesQualification(candidateDegrees, roleQualification) {
  const degrees = [candidateDegrees.graduationdegree, candidateDegrees.postgraduationdegree].filter(
    (d) => d && d.toUpperCase() !== 'NULL'
  );
  if (!roleQualification || roleQualification.toUpperCase() === 'NULL') return true;
  const roleUpper = roleQualification.toUpperCase();

  const techGrad = [
    'BTECH',
    'B.TECH',
    'B TECH',
    'BE',
    'B.E',
    'B.E.',
    'BACHELOR OF ENGINEERING',
    'BACHELOR OF TECHNOLOGY',
    'ENGINEERING GRADUATE',
    'ENGG',
    'MCA',
  ];
  const postGrad = [
    'MTECH',
    'M.TECH',
    'M TECH',
    'MSC',
    'M.SC',
    'MCA',
    'MASTER OF TECHNOLOGY',
    'MASTER OF SCIENCE',
    'MASTER OF COMPUTER APPLICATIONS',
  ];
  const grad = ['BSC', 'B.SC', 'BCA', 'BACHELOR OF SCIENCE', 'BACHELOR OF COMPUTER APPLICATIONS'];
  const normalizedDegrees = degrees.map((d) => d.toUpperCase().replace(/[^A-Z]/g, ''));

  if (roleUpper.includes('TECH_GRADUATE')) {
    return normalizedDegrees.some((d) => techGrad.some((tg) => d.includes(tg.replace(/[^A-Z]/g, ''))));
  } else if (roleUpper.includes('POST_GRADUATE')) {
    return normalizedDegrees.some((d) => postGrad.some((pg) => d.includes(pg.replace(/[^A-Z]/g, ''))));
  } else if (roleUpper.includes('GRADUATE')) {
    return normalizedDegrees.some(
      (d) => grad.some((g) => d.includes(g.replace(/[^A-Z]/g, ''))) || d.includes('BACHELOR')
    );
  } else {
    return degrees.some((d) => d.toUpperCase().includes(roleUpper));
  }
}

/**
 * Helper: Educational Group Match Checker for Checkboxes
 */
export const EDUCATION_GROUPS = {
  tech_cs_it_mca_mtech: {
    degrees: ['btech', 'b.tech', 'b tech', 'be', 'b.e', 'b e', 'mca', 'mtech', 'm.tech', 'm tech'],
    specs: ['computer', 'information technology', 'software', 'application', 'applications', 'data science', 'cybersecurity', 'cyber security', 'programming', 'network', 'web', 'it', 'cs'],
  },
  tech_other_it_msc_ms: {
    degrees: ['btech', 'b.tech', 'b tech', 'be', 'b.e', 'b e', 'msc', 'm.sc', 'm sc', 'ms'],
  },
  tech_bca_bsc_it_grad: {
    degrees: ['bca', 'bsc', 'b.sc', 'b sc'],
    specs: ['computer', 'information technology', 'software', 'application', 'applications', 'data science', 'cybersecurity', 'cyber security', 'programming', 'network', 'web', 'it', 'cs'],
  },
  fin_ca_mba_cma_icwa: {
    degrees: ['ca', 'mba', 'cma', 'icwa', 'pgdm'],
    specs: ['finance', 'fin'],
  },
  fin_mcom: { degrees: ['mcom', 'm.com', 'master of commerce'] },
  fin_bcom: { degrees: ['bcom', 'b.com', 'bachelor of commerce'] },
  sales_mba_be_btech_mca_it: {
    degrees: ['mba', 'btech', 'b.tech', 'b tech', 'be', 'b.e', 'b e', 'mca', 'bca', 'bsc', 'b.sc', 'b sc'],
    specs: ['computer', 'information technology', 'software', 'application', 'applications', 'data science', 'cybersecurity', 'cyber security', 'programming', 'network', 'web', 'it', 'cs'],
  },
  sales_any_postgrad_non_it: {
    degrees: ['master', 'postgraduate', 'pg', 'ma', 'm.a', 'msc', 'm.sc', 'm sc', 'mcom', 'm.com'],
  },
  sales_any_grad: {
    degrees: ['bachelor', 'graduate', 'degree', 'ba', 'b.a', 'bba', 'b.b.a', 'bsc', 'b.sc', 'b sc', 'bcom', 'b.com'],
  },
};

export function getCandidateEducationCategories(c) {
  const categories = [];
  const highest = (c.HighestQualification || '').toLowerCase();
  const gradDeg = (c.graduationdegree || '').toLowerCase();
  const pgDeg = (c.postgraduationdegree || '').toLowerCase();

  const cGradSpec = (c.graduationspecialization || '').toLowerCase();
  const cPgSpec = (c.postgraduationspecialization || '').toLowerCase();

  const checkMatch = (degText, specText, groupKey) => {
    const group = EDUCATION_GROUPS[groupKey];
    if (!group) return false;

    const hasDeg = group.degrees.some((d) => degText.includes(d) || highest.includes(d));
    if (!hasDeg) return false;

    if (group.specs) {
      return group.specs.some(
        (s) => specText.includes(s) || degText.includes(s) || highest.includes(s)
      );
    }
    return true;
  };

  // Tech groups
  if (
    checkMatch(gradDeg, cGradSpec, 'tech_cs_it_mca_mtech') ||
    checkMatch(pgDeg, cPgSpec, 'tech_cs_it_mca_mtech')
  ) {
    categories.push('tech_cs_it_mca_mtech');
  }

  const isBTech = ['btech', 'b.tech', 'b tech', 'be', 'b.e', 'b e'].some(
    (d) => gradDeg.includes(d) || highest.includes(d)
  );
  const isMSc = ['msc', 'm.sc', 'm sc', 'ms'].some((d) => pgDeg.includes(d) || highest.includes(d));
  if ((isBTech && !categories.includes('tech_cs_it_mca_mtech')) || isMSc) {
    categories.push('tech_other_it_msc_ms');
  }

  if (checkMatch(gradDeg, cGradSpec, 'tech_bca_bsc_it_grad')) {
    categories.push('tech_bca_bsc_it_grad');
  }

  // Non-tech fallback
  const isGraduate =
    isBTech ||
    isMSc ||
    ['bca', 'bsc', 'ba', 'bcom', 'bba', 'graduation', 'bachelor', 'graduate'].some(
      (d) => gradDeg.includes(d) || highest.includes(d)
    );
  if (
    isGraduate &&
    !categories.includes('tech_cs_it_mca_mtech') &&
    !categories.includes('tech_other_it_msc_ms') &&
    !categories.includes('tech_bca_bsc_it_grad')
  ) {
    categories.push('tech_non_it_grad');
  }

  // Finance groups
  const isCA = ['ca', 'chartered accountant', 'icai'].some(
    (d) => highest.includes(d) || gradDeg.includes(d) || pgDeg.includes(d)
  );
  const isCMA = ['cma', 'icwa'].some((d) => highest.includes(d) || gradDeg.includes(d) || pgDeg.includes(d));
  const isMbaFinance =
    ['mba', 'pgdm'].some((d) => pgDeg.includes(d) || highest.includes(d)) &&
    (cPgSpec.includes('finance') || cPgSpec.includes('fin'));
  if (isCA || isCMA || isMbaFinance) {
    categories.push('fin_ca_mba_cma_icwa');
  }

  if (['mcom', 'm.com'].some((d) => pgDeg.includes(d) || highest.includes(d))) {
    categories.push('fin_mcom');
  }
  if (['bcom', 'b.com'].some((d) => gradDeg.includes(d) || highest.includes(d))) {
    categories.push('fin_bcom');
  }
  if (isGraduate && !isCA && !isCMA && !isMbaFinance && !categories.includes('fin_mcom') && !categories.includes('fin_bcom')) {
    categories.push('fin_any_other_grad');
  }

  // Sales/HR groups
  if (
    ['mba', 'pgdm', 'btech', 'b.tech', 'be', 'b.e', 'mca', 'bca'].some(
      (d) => gradDeg.includes(d) || pgDeg.includes(d) || highest.includes(d)
    )
  ) {
    categories.push('sales_mba_be_btech_mca_it');
  }
  const isPostGraduate = ['master', 'postgraduate', 'pg', 'ma', 'm.a', 'msc', 'mcom'].some(
    (d) => pgDeg.includes(d) || highest.includes(d)
  );
  if (isPostGraduate && !categories.includes('sales_mba_be_btech_mca_it')) {
    categories.push('sales_any_postgrad_non_it');
  }
  if (isGraduate) {
    categories.push('sales_any_grad');
  }

  return categories;
}
