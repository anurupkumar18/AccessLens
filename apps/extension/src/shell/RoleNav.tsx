import React from 'react';

export type Role = 'instructor' | 'student';

interface Props {
  role: Role;
  onSelect: (role: Role) => void;
}

export function RoleNav({ role, onSelect }: Props): React.ReactElement {
  return (
    <nav aria-label="Role navigation">
      <button aria-current={role === 'instructor'} onClick={() => onSelect('instructor')}>Instructor</button>
      <button aria-current={role === 'student'} onClick={() => onSelect('student')}>Student</button>
    </nav>
  );
}
