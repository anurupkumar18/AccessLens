import axios from 'axios';

// The base URL for the Canvas instance (e.g., https://canvas.instructure.com)
const CANVAS_API_BASE = process.env.CANVAS_API_BASE || 'https://canvas.instructure.com';

// The developer API token. In a real integration, this should be scoped via OAuth2 per-user.
const CANVAS_API_TOKEN = process.env.CANVAS_API_TOKEN || '';

const client = axios.create({
  baseURL: \`\${CANVAS_API_BASE}/api/v1\`,
  headers: {
    'Authorization': \`Bearer \${CANVAS_API_TOKEN}\`,
    'Content-Type': 'application/json'
  }
});

export interface CanvasAssignment {
  id: number;
  name: string;
  description: string;
  due_at: string;
  points_possible: number;
}

export interface CanvasSubmission {
  id: number;
  assignment_id: number;
  user_id: number;
  body: string;
  score: number;
  workflow_state: string;
}

export async function getCourseAssignments(courseId: string): Promise<CanvasAssignment[]> {
  try {
    const response = await client.get(\`/courses/\${courseId}/assignments\`);
    return response.data;
  } catch (error) {
    console.error(\`Failed to fetch assignments for course \${courseId}\`, error);
    return [];
  }
}

export async function getAssignmentSubmission(courseId: string, assignmentId: string, userId: string): Promise<CanvasSubmission | null> {
  try {
    const response = await client.get(\`/courses/\${courseId}/assignments/\${assignmentId}/submissions/\${userId}\`);
    return response.data;
  } catch (error) {
    console.error(\`Failed to fetch submission for user \${userId}\`, error);
    return null;
  }
}
