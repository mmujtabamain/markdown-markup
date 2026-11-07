// angular.json loads .md files as text
declare module '*.md' {
  const text: string;
  export default text;
}
