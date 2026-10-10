import type { LocationDto, PanelSummary } from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const useLocations = () =>
  useQuery({ queryKey: ['locations'], queryFn: () => api.get<LocationDto[]>('/api/locations') });

export const usePanels = () =>
  useQuery({ queryKey: ['panels'], queryFn: () => api.get<PanelSummary[]>('/api/panels') });
