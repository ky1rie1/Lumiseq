import { CanonicalTool, type IToolContext } from '../CanonicalTool';
import type { ToolRegistry } from '../ToolRegistry';
import type { CanonicalToolSchema, ToolResult } from '../../types';
import { guideResources, operationDirectory } from '../../harness/OperationGuide';

/** Shared canonical reads: available to both the app runtime and MCP dispatch. */
export class DiscoverToolsTool extends CanonicalTool {
  constructor(private registry:ToolRegistry){super();}
  readonly schema:CanonicalToolSchema={name:'studio_discover_tools',description:'Discover operation metadata by group or canonical name. Set expand=true to add returned workspace schemas to subsequent planner requests.',workspace:'any',category:'read',riskLevel:'safe',parameters:{type:'object',properties:{
    groups:{type:'array',description:'Groups: state, observation, parameters, local, layers, layout, system.',items:{type:'string',description:'Operation group'}},
    names:{type:'array',description:'Canonical tool names or aliases.',items:{type:'string',description:'Tool name'}},
    expand:{type:'boolean',description:'Explicitly expand the runtime schema catalog.',default:false},
  },required:[]}};
  async execute(context:IToolContext,args:Record<string,any>,toolCallId:string):Promise<ToolResult>{
    const names=Array.isArray(args.names)?args.names.map((name:string)=>this.registry.get(name)?.schema.name):[];
    const directory=operationDirectory(this.registry).filter(tool=>(tool.workspace==='any'||tool.workspace===context.currentWorkspace)&&
      (!args.groups?.length||args.groups.includes(tool.group))&&(!names.length||names.includes(tool.name)));
    return {success:true,toolCallId,renderRequired:false,data:{directory,expanded:args.expand===true,schemas:args.expand===true?directory.map(tool=>this.registry.get(tool.name)!.schema):[]}};
  }
}
export class ReadGuideTool extends CanonicalTool {
  constructor(private registry:ToolRegistry){super();}
  readonly schema:CanonicalToolSchema={name:'studio_read_guide',description:'Read studio://guide/operations or studio://workflow/{precise,photo,local-detail,layout}: units, IDs, preconditions, locks, undo, recovery and workflow steps.',workspace:'any',category:'read',riskLevel:'safe',parameters:{type:'object',properties:{uri:{type:'string',description:'Guide or workflow resource URI.'}},required:['uri']}};
  async execute(_context:IToolContext,args:Record<string,any>,toolCallId:string):Promise<ToolResult>{
    const resource=guideResources(this.registry).find(item=>item.uri===args.uri);
    if(!resource)return {success:false,toolCallId,renderRequired:false,error:{code:'INVALID_ARGUMENT',message:'Unknown guide resource URI'}};
    const value=JSON.parse(resource.text);
    return {success:true,toolCallId,renderRequired:false,data:Array.isArray(value)?{uri:resource.uri,directory:value}:value};
  }
}
