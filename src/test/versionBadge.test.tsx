import { VersionBadge } from '@/components/VersionBadge';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('VersionBadge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the version + short commit SHA', () => {
    render(<VersionBadge />);
    expect(screen.getByText('v0.0.0 (test)')).toBeInTheDocument();
  });

  it('copies the label to the clipboard on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    render(<VersionBadge />);
    fireEvent.click(screen.getByRole('button'));

    expect(writeText).toHaveBeenCalledWith('v0.0.0 (test)');
  });
});
