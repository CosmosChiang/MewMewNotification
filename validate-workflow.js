#!/usr/bin/env node

// Simple GitHub Actions workflow validator
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const workflowPath = path.join(__dirname, '.github', 'workflows', 'ci.yml');

try {
  console.log('🔍 Validating GitHub Actions workflow...');
  
  if (!fs.existsSync(workflowPath)) {
    console.error('❌ Workflow file not found:', workflowPath);
    process.exit(1);
  }

  const workflowContent = fs.readFileSync(workflowPath, 'utf8');
  const workflow = yaml.load(workflowContent);

  // Basic validation checks
  const checks = [
    {
      name: 'Has name',
      check: () => workflow.name && workflow.name.length > 0,
      message: 'Workflow must have a name'
    },
    {
      name: 'Has triggers',
      check: () => workflow.on && Object.keys(workflow.on).length > 0,
      message: 'Workflow must have triggers (on)'
    },
    {
      name: 'Has jobs',
      check: () => workflow.jobs && Object.keys(workflow.jobs).length > 0,
      message: 'Workflow must have jobs'
    },
    {
      name: 'Test job exists',
      check: () => workflow.jobs.test,
      message: 'Must have a test job'
    },
    {
      name: 'Build job exists',
      check: () => workflow.jobs.build,
      message: 'Must have a build job'
    },
    {
      name: 'Test job has steps',
      check: () => workflow.jobs.test && workflow.jobs.test.steps && workflow.jobs.test.steps.length > 0,
      message: 'Test job must have steps'
    },
    {
      name: 'Build job depends on test',
      check: () => workflow.jobs.build && workflow.jobs.build.needs && workflow.jobs.build.needs.includes('test'),
      message: 'Build job should depend on test job'
    }
  ];

  let allPassed = true;
  
  checks.forEach(({ name, check, message }) => {
    try {
      if (check()) {
        console.log(`✅ ${name}`);
      } else {
        console.log(`❌ ${name}: ${message}`);
        allPassed = false;
      }
    } catch (error) {
      console.log(`❌ ${name}: Error during check - ${error.message}`);
      allPassed = false;
    }
  });

  if (allPassed) {
    console.log('\n🎉 GitHub Actions workflow validation passed!');
    console.log('📋 Summary:');
    console.log(`   - Name: ${workflow.name}`);
    console.log(`   - Triggers: ${Object.keys(workflow.on).join(', ')}`);
    console.log(`   - Jobs: ${Object.keys(workflow.jobs).join(', ')}`);
    
    // Check for test command
    const testJob = workflow.jobs.test;
    const hasTestStep = testJob.steps.some(step => 
      step.run && (step.run.includes('npm test') || step.run.includes('npm run test'))
    );
    console.log(`   - Has test step: ${hasTestStep ? '✅' : '❌'}`);
    
  } else {
    console.log('\n❌ GitHub Actions workflow validation failed!');
    process.exit(1);
  }

} catch (error) {
  console.error('❌ Error validating workflow:', error.message);
  process.exit(1);
}
