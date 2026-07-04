export function resolveStateMappedColor(
  state,
  entityMap,
  entityColor,
  globalColor
) {
  const rawState = `${state ?? ''}`;

  if (entityMap?.[rawState]) return entityMap[rawState];
  if (entityColor) return entityColor;
  if (globalColor) return globalColor;

  return '';
}
