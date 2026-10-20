/** Bound both work and shutdown/drain to an absolute, non-renewable deadline. */
export function beforeDeadline(work, deadlineAt) {
  if (deadlineAt <= Date.now())
    return Promise.reject(new Error("90s hard deadline"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("90s hard deadline")),
      deadlineAt - Date.now(),
    );
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
