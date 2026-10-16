import { z } from 'zod';
const source=z.string().url().refine(v=>/^https?:\/\//.test(v),'Public HTTP URL required');
export const speaker=z.object({name:z.string().min(1),company:z.string(),role:z.string(),topic:z.string(),kind:z.enum(['Buyer','Partner','Vendor','Unknown']),fit:z.enum(['High','Medium','Low']),whyReachOut:z.string(),question:z.string(),sourceUrl:source,evidence:z.string(),linkedin:z.union([z.literal(''),source.refine(v=>/^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9_%~-]+\/?$/.test(v),'LinkedIn person profile required')]),linkedinEvidenceUrl:z.union([z.literal(''),source]).optional(),eventName:z.string().optional(),outreachMessage:z.string().optional()});
export const event=z.object({name:z.string(),startDate:z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),endDate:z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),location:z.string(),fit:z.enum(['High','Medium','Low']),why:z.string(),participation:z.enum(['Confirmed speaker','Confirmed exhibitor','Confirmed attendee','Audience fit only']),evidence:z.string(),sourceUrl:source,caveat:z.string()});
export const report=z.object({summary:z.string(),coverage:z.string(),warnings:z.array(z.string()),events:z.array(event).max(30),speakers:z.array(speaker).max(100)});
export const input=z.object({mode:z.enum(['discover','speakers']),url:z.string().max(2048).default(''),region:z.enum(['United States + Canada','United States','Canada','Gulf Coast']).default('United States + Canada'),focus:z.string().min(3).max(1200),includePast:z.boolean().default(false)});

export const prospect=z.union([speaker,event]);
