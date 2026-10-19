const skills = [
  "JavaScript", "TypeScript", "React", "Next.js", "NestJS", "Node.js", "Angular", "Vue", "HTML", "CSS", "Tailwind CSS", "Redux",
  "Python", "Java", "C++", "C#", ".NET", "PHP", "Laravel", "Ruby", "Rails", "Go", "Rust", "Swift", "Kotlin", "Flutter", "React Native",
  "PostgreSQL", "MySQL", "MongoDB", "SQL", "Redis", "GraphQL", "REST", "Docker", "Kubernetes", "AWS", "Azure", "GCP", "Git", "Linux",
  "Django", "Flask", "FastAPI", "Spring Boot", "Express", "Prisma", "TypeORM", "Jest", "Cypress", "Playwright", "Selenium", "CI/CD",
  "Machine Learning", "Deep Learning", "TensorFlow", "PyTorch", "Pandas", "NumPy", "Power BI", "Tableau", "Excel", "Data Analysis",
  "Figma", "UI/UX", "User Research", "Graphic Design", "Photoshop", "Illustrator", "SEO", "Content Marketing", "Google Analytics",
  "Project Management", "Agile", "Scrum", "Product Management", "Sales", "Customer Service", "Accounting", "Financial Analysis", "Recruitment",
];
const aliases: Record<string, string[]> = {
  "Next.js": ["nextjs", "next js"], "Node.js": ["nodejs", "node js"], "NestJS": ["nest.js", "nest js"],
  "React": ["reactjs", "react.js"], "Vue": ["vuejs", "vue.js"], "Tailwind CSS": ["tailwind"],
  "PostgreSQL": ["postgres"], "AWS": ["amazon web services"], "GCP": ["google cloud"],
};
function contains(text: string, phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(text);
}
export function extractKeywords(text: string) {
  const normalized = text.replace(/\s+/g, " ");
  const keywords = skills.filter(skill => [skill, ...(aliases[skill] ?? [])].some(alias => contains(normalized, alias)));
  const roles = ["Full Stack Developer", "Full Stack Software Engineer", "Frontend Developer", "Frontend Engineer", "Backend Developer", "Backend Engineer", "Software Engineer", "Software Developer", "Data Scientist", "Data Analyst", "DevOps Engineer", "Product Designer", "UX Designer", "UI Designer", "Product Manager", "Project Manager", "Digital Marketing Specialist", "Accountant", "Sales Manager"];
  const role = roles.find(role => contains(normalized.replace(/front-end/gi, "frontend").replace(/back-end/gi, "backend").replace(/full[- ]stack/gi, "full stack"), role));
  return { keywords, suggestedRole: role ?? "", warning: keywords.length ? null : "No recognized skills found. Add your skills manually before searching." };
}

export function buildJobQuery(role: string, keywords: string[]) {
  return [role.trim(), ...Array.from(new Set(keywords.map(skill => skill.trim()).filter(Boolean))).slice(0, 5)].filter(Boolean).join(" ");
}
