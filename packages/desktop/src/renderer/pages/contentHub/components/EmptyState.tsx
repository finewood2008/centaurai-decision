/**
 * EmptyState — shared loading / empty placeholder for hub panels.
 */
import React from 'react';

type EmptyStateProps = {
  loading?: boolean;
  message: string;
  loadingMessage: string;
};

const EmptyState: React.FC<EmptyStateProps> = ({ loading, message, loadingMessage }) => (
  <div className='flex-1 flex items-center justify-center text-t-secondary'>{loading ? loadingMessage : message}</div>
);

export default EmptyState;
