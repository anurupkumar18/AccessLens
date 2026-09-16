import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div role="alert">
          <h2>Something went wrong</h2>
          <p>AccessLens hit an unexpected error and stopped rendering this view.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
