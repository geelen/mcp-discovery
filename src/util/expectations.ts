export type ExpectationCheck = {
  expectation: string;
  found: boolean;
};

function normalizeForComparison(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function checkExpectations(
  answer: string,
  expectations: string[]
): { allFound: boolean; checks: ExpectationCheck[] } {
  const normalizedAnswer = normalizeForComparison(answer);

  const checks: ExpectationCheck[] = expectations.map((exp) => ({
    expectation: exp,
    found: normalizedAnswer.includes(normalizeForComparison(exp)),
  }));

  return {
    allFound: checks.every((c) => c.found),
    checks,
  };
}
