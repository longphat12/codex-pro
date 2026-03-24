import readline from 'node:readline';

export const createPromptInterface = (options = {}) => readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  ...options
});

export const askQuestion = (question, options = {}) => new Promise((resolve) => {
  const rl = createPromptInterface(options);
  rl.question(question, (answer) => {
    rl.close();
    resolve(answer);
  });
});

export const confirmAction = async (question, options = {}) => {
  const answer = await askQuestion(question, options);
  return answer.trim().toLowerCase() === 'y';
};
