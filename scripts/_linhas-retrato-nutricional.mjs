// Formats the `formulaSnapshot` lines printed by diagnosticar-retrato-nutricional.mjs.
// Kept in its own module so the formatting can be tested without a database.
//
// A snapshot written before the rest day had its own target has no `restDay`:
// it is still read, and the rest-day line says so instead of failing.

export function linhasFormulaSnapshot(fs) {
  if (!fs) return ['      formulaSnapshot: AUSENTE'];
  const linhas = [
    `      formulaSnapshot: presente · fase=${fs.phase} · peso=${fs.weightKgUsed}kg · metas=${JSON.stringify(fs.targets)}`,
  ];
  if (fs.restDay) {
    linhas.push(
      `      dia de descanso: coeficientes=${fs.restDay.proteinPerKg}/${fs.restDay.carbPerKg}/${fs.restDay.fatPerKg} · metas=${JSON.stringify(fs.restDay.targets)}`,
    );
  } else {
    linhas.push('      dia de descanso: (retrato anterior à meta do dia de descanso — sem restDay)');
  }
  return linhas;
}
