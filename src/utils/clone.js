function clone(object) {
  return JSON.parse(JSON.stringify(object));
}

export default clone;
