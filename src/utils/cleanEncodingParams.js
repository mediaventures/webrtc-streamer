function cleanEncodingParams(params) {
  const allowedKeys = ['maxBitrate', 'priority', 'networkPriority', 'scaleResolutionDownBy', 'maxFramerate'];
  const cleanedParams = allowedKeys.reduce((acc, key) => {
    if (key in params) {
      acc[key] = params[key];
    }
    return acc;
  }, {});

  // ensure it's a number or undefined
  ['maxBitrate', 'scaleResolutionDownBy', 'maxFramerate'].forEach(key => {
    cleanedParams[key] = Number(cleanedParams[key]);
    if (Number.isNaN(cleanedParams[key])) {
      cleanedParams[key] = undefined;
    }
  });

  const priority = cleanedParams.priority || cleanedParams.networkPriority;
  if (priority) {
    cleanedParams.priority = priority;
    const priorityValues = ['very-low', 'low', 'medium', 'high'];
    if (!priorityValues.includes(cleanedParams.priority)) {
      cleanedParams.priority = 'low';
    }
    cleanedParams.networkPriority = cleanedParams.priority;
  }
  return cleanedParams;
}
export default cleanEncodingParams;
