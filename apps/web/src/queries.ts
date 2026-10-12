import type { GeneratorSummary, LocationDto, PanelSummary, PowerDeviceSummary, TransferSwitchDto } from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const useLocations = () =>
  useQuery({ queryKey: ['locations'], queryFn: () => api.get<LocationDto[]>('/api/locations') });

export const usePanels = () =>
  useQuery({ queryKey: ['panels'], queryFn: () => api.get<PanelSummary[]>('/api/panels') });

export const useGenerators = () =>
  useQuery({ queryKey: ['generators'], queryFn: () => api.get<GeneratorSummary[]>('/api/generators') });

export const useTransferSwitches = () =>
  useQuery({ queryKey: ['transfer-switches'], queryFn: () => api.get<TransferSwitchDto[]>('/api/transfer-switches') });

export const usePowerDevices = () =>
  useQuery({ queryKey: ['power-devices'], queryFn: () => api.get<PowerDeviceSummary[]>('/api/power-devices') });
